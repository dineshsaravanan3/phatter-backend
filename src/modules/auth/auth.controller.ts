import { Controller, Post, Get, Body, Req, Res, UseGuards, UnauthorizedException, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './jwt.guard';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private getCookieOptions(req: Request) {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as const,
      path: '/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute for registration
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User successfully registered' })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto.name, registerDto.email, registerDto.password);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute for login
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiHeader({ name: 'x-client-type', required: false, description: 'Client type: web, mobile, or electron' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const rawClientType = req.headers['x-client-type'];
    const clientType = typeof rawClientType === 'string' ? rawClientType.toLowerCase() : undefined;
    const validatedClientType = ['mobile', 'electron'].includes(clientType || '') ? clientType : 'web';

    const result = await this.authService.login(user, validatedClientType === 'web' ? undefined : req.body.deviceId);

    // For web client, set cookie and omit refresh token from body
    if (validatedClientType === 'web') {
      res.cookie('refresh_token', result.refreshToken, this.getCookieOptions(req));
      return {
        user: result.user,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
      };
    }

    // For mobile/Electron client, return refresh token in JSON response body
    return {
      user: result.user,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
      refreshToken: result.refreshToken,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke current active session' })
  @ApiHeader({ name: 'x-client-type', required: false, description: 'Client type: web, mobile, or electron' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @Body() refreshDto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawClientType = req.headers['x-client-type'];
    const clientType = typeof rawClientType === 'string' ? rawClientType.toLowerCase() : undefined;
    const validatedClientType = ['mobile', 'electron'].includes(clientType || '') ? clientType : 'web';

    let refreshToken = refreshDto.refreshToken;

    if (validatedClientType === 'web') {
      refreshToken = req.cookies['refresh_token'];
      res.clearCookie('refresh_token', { path: '/auth' });
    }

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    return { message: 'Logged out successfully' };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute for refresh
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh authentication tokens' })
  @ApiHeader({ name: 'x-client-type', required: false, description: 'Client type: web, mobile, or electron' })
  @ApiResponse({ status: 200, description: 'Tokens successfully refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token or token reuse detected' })
  async refresh(
    @Body() refreshDto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawClientType = req.headers['x-client-type'];
    const clientType = typeof rawClientType === 'string' ? rawClientType.toLowerCase() : undefined;
    const validatedClientType = ['mobile', 'electron'].includes(clientType || '') ? clientType : 'web';

    let refreshToken = refreshDto.refreshToken;

    // For web clients, read from cookie
    if (validatedClientType === 'web') {
      refreshToken = req.cookies['refresh_token'];
    }

    if (!refreshToken) {
      if (validatedClientType === 'web') {
        res.clearCookie('refresh_token', { path: '/auth' });
      }
      throw new UnauthorizedException('No refresh token provided');
    }

    try {
      const result = await this.authService.refresh(refreshToken, refreshDto.deviceId);

      // Web response: set cookie, omit token from body
      if (validatedClientType === 'web') {
        res.cookie('refresh_token', result.refreshToken, this.getCookieOptions(req));
        return {
          user: result.user,
          accessToken: result.accessToken,
          accessTokenExpiresAt: result.accessTokenExpiresAt,
        };
      }

      // Mobile/Electron response: return token in body
      return {
        user: result.user,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        refreshToken: result.refreshToken,
      };
    } catch (error) {
      // Clear cookie immediately on web to prevent auth loops on failure
      if (validatedClientType === 'web') {
        res.clearCookie('refresh_token', { path: '/auth' });
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Profile returned successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async me(@Req() req: any) {
    return { user: req.user };
  }
}
