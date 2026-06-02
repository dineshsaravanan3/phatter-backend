import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UseFilters } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: (requestOrigin, callback) => {
      const localhostOrigins = ['http://localhost:3000', 'http://localhost:4000', 'http://127.0.0.1:3000'];
      const productionOrigins = ['https://phatter.vercel.app', 'https://phatter.vercel.app/'];
      const envOrigins = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(o => o.trim()) : [];
      const allowedOrigins = [...new Set([...localhostOrigins, ...productionOrigins, ...envOrigins])];
      
      const normalizedOrigin = requestOrigin ? requestOrigin.replace(/\/$/, '') : '';
      const isAllowed = !requestOrigin || allowedOrigins.some(o => o.replace(/\/$/, '') === normalizedOrigin);
      
      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`WebSocket CORS blocked origin: ${requestOrigin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // In-memory mapping of User ID -> Set of socket connection IDs (supports multiple tabs)
  private activeConnections = new Map<string, Set<string>>();

  // In-memory map to store socket disconnect timeouts matching JWT token expirations
  private socketExpiryTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  // Expose the active connections map so the ChatService can check online statuses
  getOnlineUsers(): Set<string> {
    return new Set(this.activeConnections.keys());
  }

  async handleConnection(client: Socket) {
    try {
      // 1. Extract Token from handshake auth or query or headers
      let token = client.handshake.auth?.token || client.handshake.headers?.authorization;
      if (!token && client.handshake.query?.token) {
        token = client.handshake.query.token as string;
      }

      if (token && token.startsWith('Bearer ')) {
        token = token.substring(7);
      }

      if (!token) {
        throw new Error('No authentication token provided');
      }

      // 2. Validate Token
      const secret = this.configService.get<string>('JWT_SECRET', 'dci-platform-super-secret-key-12345');
      const payload = this.jwtService.verify(token, { secret });

      if (!payload || !payload.sub) {
        throw new Error('Invalid authentication payload');
      }

      const userId = payload.sub;
      client.data.userId = userId;

      // Join the user-specific room to receive direct notifications/updates
      await client.join(`user:${userId}`);

      // 3. Register socket in presence system
      if (!this.activeConnections.has(userId)) {
        this.activeConnections.set(userId, new Set());
        // First tab connected: notify channels
        this.server.emit('user:status_change', {
          userId,
          status: 'online',
        });
      }
      this.activeConnections.get(userId)!.add(client.id);

      // 4. Register connection timeout if JWT token has an expiration
      if (payload.exp) {
        const timeUntilExpiryMs = payload.exp * 1000 - Date.now();
        if (timeUntilExpiryMs > 0) {
          const timeout = setTimeout(() => {
            client.emit('auth:expired', { message: 'Session expired' });
            client.disconnect(true);
          }, timeUntilExpiryMs);
          this.socketExpiryTimeouts.set(client.id, timeout);
        } else {
          // Token already expired
          client.disconnect(true);
          return;
        }
      }

      console.log(`Socket client connected: ${client.id} (user: ${userId})`);
    } catch (err: any) {
      console.log(`Socket connection rejected: ${client.id} - Reason: ${err.message}`);
      client.emit('error', { message: 'Unauthorized connection' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    const socketId = client.id;

    // Clear any token expiry timeout
    const timeout = this.socketExpiryTimeouts.get(socketId);
    if (timeout) {
      clearTimeout(timeout);
      this.socketExpiryTimeouts.delete(socketId);
    }

    if (userId) {
      const userSockets = this.activeConnections.get(userId);
      if (userSockets) {
        userSockets.delete(socketId);
        if (userSockets.size === 0) {
          // Last tab closed: user is now offline
          this.activeConnections.delete(userId);

          // Update database once
          const lastSeenAt = new Date();
          await this.prisma.client.user.update({
            where: { id: userId },
            data: { lastSeenAt },
          }).catch((err) => console.error('Failed to update last seen', err));

          // Broadcast offline event
          this.server.emit('user:status_change', {
            userId,
            status: 'offline',
            lastSeenAt,
          });
        }
      }
    }

    console.log(`Socket client disconnected: ${socketId}`);
  }

  @SubscribeMessage('join_channel')
  async handleJoinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ) {
    const userId = client.data.userId;
    if (!userId || !data?.channelId) return;

    try {
      // Server-side validation: must belong to the channel
      await this.chatService.validateMembership(data.channelId, userId);

      await client.join(`channel:${data.channelId}`);
      console.log(`Socket ${client.id} joined channel room: channel:${data.channelId}`);
      client.emit('joined_channel', { channelId: data.channelId });
    } catch (err) {
      client.emit('error', { message: 'Forbidden room subscription' });
    }
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ) {
    const userId = client.data.userId;
    if (!userId || !data?.channelId) return;

    try {
      await this.chatService.validateMembership(data.channelId, userId);
      client.to(`channel:${data.channelId}`).emit('typing:state', {
        channelId: data.channelId,
        userId,
        isTyping: true,
      });
    } catch (err) {
      // Ignore unauthorized attempts
    }
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string },
  ) {
    const userId = client.data.userId;
    if (!userId || !data?.channelId) return;

    try {
      await this.chatService.validateMembership(data.channelId, userId);
      client.to(`channel:${data.channelId}`).emit('typing:state', {
        channelId: data.channelId,
        userId,
        isTyping: false,
      });
    } catch (err) {
      // Ignore unauthorized attempts
    }
  }

  // Helper method to broadcast newly created messages to active room members
  async broadcastNewMessage(channelId: string, message: any, tempId?: string) {
    try {
      const members = await this.prisma.client.channelMember.findMany({
        where: { channelId },
        select: { userId: true },
      });

      for (const member of members) {
        this.server.to(`user:${member.userId}`).emit('new_message', {
          ...message,
          tempId,
        });
      }
    } catch (err) {
      console.error('Failed to broadcast message to individual user rooms, falling back to channel room', err);
      this.server.to(`channel:${channelId}`).emit('new_message', {
        ...message,
        tempId,
      });
    }
  }

  broadcastMessagePin(channelId: string, messageId: string, isPinned: boolean) {
    this.server.to(`channel:${channelId}`).emit('message:pin', {
      channelId,
      messageId,
      isPinned,
    });
  }

  broadcastMessageReaction(channelId: string, messageId: string, reactions: any) {
    this.server.to(`channel:${channelId}`).emit('message:reaction', {
      channelId,
      messageId,
      reactions,
    });
  }

  broadcastNewConversation(channel: any) {
    try {
      const members = channel.members || [];
      for (const member of members) {
        this.server.to(`user:${member.userId}`).emit('conversation:created', {
          channelId: channel.id,
          channelType: channel.type,
          channelName: channel.name,
        });
      }
    } catch (err) {
      console.error('Failed to broadcast new conversation', err);
    }
  }
}
