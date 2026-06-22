import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private scheduledMessageInterval: NodeJS.Timeout | null = null;
  private actionCleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
    private readonly chatService: ChatService,
  ) {}

  onModuleInit() {
    // Poll for pending scheduled messages every 15 seconds
    this.scheduledMessageInterval = setInterval(() => this.processScheduledMessages(), 15 * 1000);

    // Clean up expired AI pending actions every 5 minutes
    this.actionCleanupInterval = setInterval(() => this.cleanupExpiredActions(), 5 * 60 * 1000);

    console.log('SchedulerService initialized.');
  }

  onModuleDestroy() {
    if (this.scheduledMessageInterval) clearInterval(this.scheduledMessageInterval);
    if (this.actionCleanupInterval) clearInterval(this.actionCleanupInterval);
  }

  // Transactionally locks and processes scheduled messages to prevent duplicate delivery
  async processScheduledMessages() {
    try {
      const now = new Date();

      // Scheduler locking must be implemented using database transactions or row-level locking 
      // to prevent multiple application instances from processing the same scheduled message.
      const messagesToProcess = await this.prisma.client.$transaction(async (tx) => {
        const pending = await tx.scheduledMessage.findMany({
          where: {
            sent: false,
            processing: false,
            scheduledAt: { lte: now }
          },
          take: 10,
          select: { id: true }
        });

        if (pending.length === 0) return [];

        const ids = pending.map(m => m.id);

        // Mark processing to lock rows
        await tx.scheduledMessage.updateMany({
          where: { id: { in: ids } },
          data: { processing: true }
        });

        return ids;
      });

      if (messagesToProcess.length === 0) return;

      for (const id of messagesToProcess) {
        try {
          const sm = await this.prisma.client.scheduledMessage.findUnique({
            where: { id }
          });

          if (!sm) continue;

          // Deliver message using ChatService rules (as the user who scheduled it)
          const message = await this.chatService.saveMessage(sm.channelId, sm.scheduledBy, sm.content);

          const formattedMessage = {
            id: message.id,
            text: message.content,
            senderId: message.userId,
            senderName: message.user.name,
            senderAvatar: message.user.avatarUrl || undefined,
            timestamp: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            createdAt: message.createdAt.toISOString(),
            isSelf: false,
            channelId: sm.channelId,
            parentId: undefined,
            isSystem: false,
          };

          // Broadcast via WebSockets
          await this.chatGateway.broadcastNewMessage(sm.channelId, formattedMessage);

          // Update message state to sent
          await this.prisma.client.scheduledMessage.update({
            where: { id },
            data: { sent: true, processing: false }
          });

        } catch (err) {
          console.error(`Failed to process scheduled message ${id}:`, err);
          // Release lock on failure
          await this.prisma.client.scheduledMessage.update({
            where: { id },
            data: { processing: false }
          }).catch(console.error);
        }
      }
    } catch (error) {
      console.error('Error running scheduled messages poller:', error);
    }
  }

  // Lightweight cleaner to mark stale confirmations as expired
  async cleanupExpiredActions() {
    try {
      const now = new Date();
      const result = await this.prisma.client.aiPendingAction.updateMany({
        where: {
          status: 'pending',
          expiresAt: { lt: now }
        },
        data: {
          status: 'expired'
        }
      });
      if (result.count > 0) {
        console.log(`Cleaned up ${result.count} expired AI pending actions.`);
      }
    } catch (error) {
      console.error('Failed to clean up expired AI actions:', error);
    }
  }
}
