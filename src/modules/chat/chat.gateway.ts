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
      const defaultOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://phatter.vercel.app', 'https://collab.firebeam.space'];
      const allowedOrigins = process.env.FRONTEND_URL
        ? [...defaultOrigins, ...process.env.FRONTEND_URL.split(',').map(o => o.trim().replace(/\/$/, ''))]
        : defaultOrigins;

      const cleanOrigin = requestOrigin ? requestOrigin.trim().replace(/\/$/, '') : '';

      if (!requestOrigin || allowedOrigins.includes(cleanOrigin) || allowedOrigins.some(o => cleanOrigin.startsWith(o))) {
        callback(null, true);
      } else {
        callback(new Error(`Not allowed by CORS: ${requestOrigin}`));
      }
    },
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // In-memory mapping of User ID -> Socket ID -> 'online' | 'offline'
  private activeConnections = new Map<string, Map<string, 'online' | 'offline'>>();

  // In-memory map to store socket disconnect timeouts matching JWT token expirations
  private socketExpiryTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) { }

  getOnlineUsers(): Set<string> {
    const onlineUsers = new Set<string>();
    for (const [userId, sockets] of this.activeConnections.entries()) {
      let isOnline = false;
      for (const status of sockets.values()) {
        if (status === 'online') {
          isOnline = true;
          break;
        }
      }
      if (isOnline) onlineUsers.add(userId);
    }
    return onlineUsers;
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
        this.activeConnections.set(userId, new Map());
      }
      const userSockets = this.activeConnections.get(userId)!;
      userSockets.set(client.id, 'online');

      // Re-evaluate overall user status (might have been offline due to all tabs being idle)
      this.server.emit('user:status_change', {
        userId,
        status: 'online',
      });

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

        let hasOnlineSocket = false;
        for (const status of userSockets.values()) {
          if (status === 'online') {
            hasOnlineSocket = true;
            break;
          }
        }

        if (userSockets.size === 0) {
          this.activeConnections.delete(userId);
        }

        if (!hasOnlineSocket) {
          // All tabs closed or idle: user is now offline
          const lastSeenAt = new Date();
          await this.prisma.client.user.update({
            where: { id: userId },
            data: { lastSeenAt },
          }).catch((err) => console.error('Failed to update last seen', err));

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

  @SubscribeMessage('user:presence')
  async handleUserPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { status: 'online' | 'offline' | 'inactive' },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    let targetStatus: 'online' | 'offline' = data.status === 'inactive' ? 'offline' : data.status;

    const userSockets = this.activeConnections.get(userId);
    if (userSockets) {
      userSockets.set(client.id, targetStatus);
    }

    // Determine overall user status
    let isUserOnline = false;
    if (userSockets) {
      for (const status of userSockets.values()) {
        if (status === 'online') {
          isUserOnline = true;
          break;
        }
      }
    }

    const overallStatus = isUserOnline ? 'online' : 'offline';

    // Only broadcast if the state implies offline or if we want to ensure online state
    // To minimize spam, we can just broadcast the resolved state
    const lastSeenAt = new Date();

    if (overallStatus === 'offline') {
      await this.prisma.client.user.update({
        where: { id: userId },
        data: { lastSeenAt },
      }).catch((err) => console.error('Failed to update last seen', err));
    }

    this.server.emit('user:status_change', {
      userId,
      status: overallStatus,
      lastSeenAt,
    });
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

        // Send toast notification to recipients who are not the sender
        if (member.userId !== message.senderId) {
          this.server.to(`user:${member.userId}`).emit('notification:new', {
            type: 'message',
            channelId,
            senderId: message.senderId,
            senderName: message.senderName,
            senderAvatar: message.senderAvatar ?? null,
            text: message.text,
            timestamp: message.timestamp,
          });
        }
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
  async broadcastMessageReaction(channelId: string, messageId: string, reactions: any) {
    try {
      const members = await this.prisma.client.channelMember.findMany({
        where: { channelId },
        select: { userId: true },
      });

      const message = await this.prisma.client.message.findUnique({
        where: { id: messageId },
        include: {
          user: { select: { id: true, name: true } },
        },
      });

      const latestReaction = await this.prisma.client.messageReaction.findFirst({
        where: { messageId },
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true } },
        },
      });

      if (message && latestReaction) {
        for (const member of members) {
          this.server.to(`user:${member.userId}`).emit('message:reaction_notification', {
            channelId,
            messageId,
            emoji: latestReaction.emoji,
            reactorName: latestReaction.user.name,
            reactorId: latestReaction.user.id,
            messageContent: message.content,
            createdAt: latestReaction.createdAt.toISOString(),
          });
        }
      }
    } catch (err) {
      console.error('Failed to broadcast reaction notification', err);
    }

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

  broadcastMessageDeletion(channelId: string, messageId: string) {
    this.server.to(`channel:${channelId}`).emit('message:delete', {
      channelId,
      messageId,
    });
  }
}
