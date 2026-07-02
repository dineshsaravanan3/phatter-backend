import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import {
  AuthResponse,
  AuthUserResponse,
} from './interfaces/auth-response.interface';

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.jwtSecret = this.configService.get<string>(
      'JWT_SECRET',
      'dci-platform-super-secret-key-12345',
    );
    this.jwtRefreshSecret = this.configService.get<string>(
      'JWT_REFRESH_SECRET',
      'dci-platform-another-super-secret-key-67890',
    );
  }

  // Hash a token using SHA-256 for deterministic indexed database lookup
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.prisma.client.user.findUnique({
      where: { email },
    });

    if (user && (await bcrypt.compare(pass, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(
    user: any,
    deviceId?: string,
  ): Promise<AuthResponse & { refreshToken: string }> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    // Access Token: 15 minutes (900 seconds)
    const accessTokenExpiresInSeconds = 900;
    const accessTokenExpiresAt =
      Math.floor(Date.now() / 1000) + accessTokenExpiresInSeconds;

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.jwtSecret,
      expiresIn: `${accessTokenExpiresInSeconds}s`,
    });

    // Refresh Token: 30 days
    const refreshTokenExpiresInDays = 30;
    const refreshTokenExpiresAt = new Date();
    refreshTokenExpiresAt.setDate(
      refreshTokenExpiresAt.getDate() + refreshTokenExpiresInDays,
    );

    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, deviceId },
      {
        secret: this.jwtRefreshSecret,
        expiresIn: `${refreshTokenExpiresInDays}d`,
      },
    );

    const tokenHash = this.hashToken(refreshToken);

    // Save refresh token to database
    await this.prisma.client.refreshToken.create({
      data: {
        userId: user.id,
        deviceId: deviceId || null,
        tokenHash,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    const userResponse: AuthUserResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };

    return {
      user: userResponse,
      accessToken,
      accessTokenExpiresAt,
      refreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    // Find and delete the session token
    await this.prisma.client.refreshToken.deleteMany({
      where: { tokenHash },
    });
  }

  async refresh(
    refreshToken: string,
    deviceId?: string,
  ): Promise<AuthResponse & { refreshToken: string }> {
    const tokenHash = this.hashToken(refreshToken);

    // Look up the refresh token in the database
    const dbToken = await this.prisma.client.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    // 1. If the token is not found at all, throw Unauthorized
    if (!dbToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 2. Token Reuse Detection (Replay attack prevention)
    if (dbToken.revokedAt) {
      // Immediately revoke ALL sessions for this user
      await this.prisma.client.refreshToken.deleteMany({
        where: { userId: dbToken.userId },
      });
      // Throw 401 with a specific message
      throw new UnauthorizedException('token_reuse_detected');
    }

    // 3. If the token has expired
    if (dbToken.expiresAt < new Date()) {
      // Clean up the expired token from DB
      await this.prisma.client.refreshToken.delete({
        where: { id: dbToken.id },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    // Mark current refresh token as revoked/rotated
    await this.prisma.client.refreshToken.update({
      where: { id: dbToken.id },
      data: { revokedAt: new Date() },
    });

    // Generate a fresh new pair
    const user = dbToken.user;
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessTokenExpiresInSeconds = 900;
    const accessTokenExpiresAt =
      Math.floor(Date.now() / 1000) + accessTokenExpiresInSeconds;

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.jwtSecret,
      expiresIn: `${accessTokenExpiresInSeconds}s`,
    });

    const refreshTokenExpiresInDays = 30;
    const newRefreshTokenExpiresAt = new Date();
    newRefreshTokenExpiresAt.setDate(
      newRefreshTokenExpiresAt.getDate() + refreshTokenExpiresInDays,
    );

    const newRefreshToken = await this.jwtService.signAsync(
      { sub: user.id, deviceId: deviceId || dbToken.deviceId },
      {
        secret: this.jwtRefreshSecret,
        expiresIn: `${refreshTokenExpiresInDays}d`,
      },
    );

    const newTokenHash = this.hashToken(newRefreshToken);

    // Save the new rotated refresh token in the database
    await this.prisma.client.refreshToken.create({
      data: {
        userId: user.id,
        deviceId: deviceId || dbToken.deviceId,
        tokenHash: newTokenHash,
        expiresAt: newRefreshTokenExpiresAt,
      },
    });

    // Clean up older revoked or expired tokens for the user in the background
    try {
      const cleanupDate = new Date();
      cleanupDate.setDate(cleanupDate.getDate() - 7);
      await this.prisma.client.refreshToken.deleteMany({
        where: {
          userId: user.id,
          OR: [
            { revokedAt: { lte: cleanupDate } },
            { expiresAt: { lte: new Date() } },
          ],
        },
      });
    } catch (e) {
      // Fail silently for background database cleanup
    }

    const userResponse: AuthUserResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };

    return {
      user: userResponse,
      accessToken,
      accessTokenExpiresAt,
      refreshToken: newRefreshToken,
    };
  }

  async register(
    name: string,
    email: string,
    pass: string,
  ): Promise<AuthUserResponse> {
    const existingUser = await this.prisma.client.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(pass, 10);

    const user = await this.prisma.client.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: 'member',
        status: 'offline',
      },
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
  }

  async updateProfile(userId: string, name: string): Promise<AuthUserResponse> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Name cannot be empty');
    }
    const user = await this.prisma.client.user.update({
      where: { id: userId },
      data: { name: trimmedName },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
  }
}
