import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  // Ensures a default workspace exists in the system to satisfy DB foreign keys
  async ensureDefaultWorkspace(userId: string): Promise<string> {
    const existing = await this.prisma.client.workspace.findFirst();
    if (existing) {
      return existing.id;
    }
    const workspace = await this.prisma.client.workspace.create({
      data: {
        name: 'Default Workspace',
        slug: 'default-workspace',
        createdBy: userId,
      },
    });
    return workspace.id;
  }

  async ensureDefaultChannels(workspaceId: string, userId: string): Promise<void> {
    const mockUsers = [
      {
        email: 'sarah.jenkins@collabhq.com',
        name: 'Sarah Jenkins',
        avatarUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA7GMq0sMHM58XltYyz0GfvxT-Vg0x-DUjmSNLIu5J_vqVDLKNs2NCNoJQKPMBQqGPWfKU2nhs_lgf0Zng8GZpcvHFBsAa9aqYaGhFu5FiX1dllC8jRa1ZLvpTgfDDHwDyTOOtmj4P8Z17lPDGautCcmoXnNjHbGWxI41N6P-5q76MYBLPG-etgI-na5_xnHuAhLTkST9q1GtKWKlAqnDQLHrS6nWU-QwopacgWBjgpIDYDQyQiwbB5FrMC4yv25Mm8S3N3Lh8v0Ei4',
        role: 'member',
        passwordHash: '$2b$10$nSSDcSkbW5Gv/LzG/D/fyeaM5Z9lO5N.tF.32a.1P/6tBebpBvjLq',
      },
      {
        email: 'marcus.chen@collabhq.com',
        name: 'Marcus Chen',
        avatarUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA2LfVxovcRokOAhHFoeZugJvcqrXq7zHW-c0WbQcrVXwoqIgA_brAB-kC0UaTUva4dUvMWl71XOa3kT7dGt8ptso2c58ClgPi4luU6W7ZfJnIok5YhrwG5sR6TWzzysaLMqFpyGLOsa7-spUB3kOMXQEc3z213wTwdrdi1EYncngL1TRqLvELJuYHxw5xZOk2DcDFcdl9Metkt8SvmqDuSCHOHPWOC1biNnclukBCeiXNyXbjczgFacr0Aq-HGoSeW9jgsJyB21WPP',
        role: 'member',
        passwordHash: '$2b$10$nSSDcSkbW5Gv/LzG/D/fyeaM5Z9lO5N.tF.32a.1P/6tBebpBvjLq',
      },
    ];

    for (const u of mockUsers) {
      const exists = await this.prisma.client.user.findUnique({ where: { email: u.email } });
      if (!exists) {
        await this.prisma.client.user.create({
          data: {
            email: u.email,
            name: u.name,
            avatarUrl: u.avatarUrl,
            role: u.role as any,
            passwordHash: u.passwordHash,
          },
        });
      }
    }

    const defaultChannels = [
      { name: 'general', description: 'General announcements and chit-chat' },
      { name: 'product-design', description: 'Product design discussions' },
      { name: 'engineering', description: 'Technical development and code chat' },
    ];

    const allUsers = await this.prisma.client.user.findMany({ select: { id: true } });

    for (const ch of defaultChannels) {
      let channel = await this.prisma.client.channel.findFirst({
        where: { workspaceId, name: ch.name },
      });

      if (!channel) {
        channel = await this.prisma.client.channel.create({
          data: {
            workspaceId,
            name: ch.name,
            description: ch.description,
            type: 'public',
            createdBy: userId,
          },
        });
      }

      for (const u of allUsers) {
        const isMember = await this.prisma.client.channelMember.findUnique({
          where: { channelId_userId: { channelId: channel.id, userId: u.id } },
        });
        if (!isMember) {
          await this.prisma.client.channelMember.create({
            data: {
              channelId: channel.id,
              userId: u.id,
              role: 'member',
            },
          });
        }
      }

      if (ch.name === 'product-design') {
        const msgCount = await this.prisma.client.message.count({ where: { channelId: channel.id } });
        if (msgCount === 0) {
          const sarah = await this.prisma.client.user.findUnique({ where: { email: 'sarah.jenkins@collabhq.com' } });
          const marcus = await this.prisma.client.user.findUnique({ where: { email: 'marcus.chen@collabhq.com' } });

          if (sarah && marcus) {
            const baseTime = Date.now();
            const parentMsg = await this.prisma.client.message.create({
              data: {
                channelId: channel.id,
                userId: sarah.id,
                content: `Hey team, initiating discussion on Design System v2. We need to align on the core visual tokens before engineering starts implementation next sprint. 🎨\n\nKey focus areas:\n- Refining the graphite/dark mode contrast ratios.\n- Standardizing the 8px baseline grid across all major components.\n- Updating the typography scale for better mobile legibility.\n\nPlease drop your thoughts or link your Figma drafts below.`,
                type: 'text',
                createdAt: new Date(baseTime - 3 * 60 * 1000),
              },
            });

            await this.prisma.client.file.create({
              data: {
                messageId: parentMsg.id,
                channelId: channel.id,
                uploaderId: sarah.id,
                name: 'Tokens_v2_Draft.fig',
                s3Key: 'tokens_v2_draft.fig',
                cdnUrl: 'https://figma.com/file/tokens_v2_draft',
                mimeType: 'application/octet-stream',
                sizeBytes: 1572864,
                createdAt: new Date(baseTime - 3 * 60 * 1000),
              },
            });

            await this.prisma.client.message.create({
              data: {
                channelId: channel.id,
                userId: marcus.id,
                content: `I reviewed the Figma draft. The contrast ratios on the primary buttons (Slate Blue on Z-1 surface) look a bit tight against WCAG AAA standards. We might need to bump the brightness of the text or deepen the button fill slightly.`,
                type: 'text',
                parentId: parentMsg.id,
                createdAt: new Date(baseTime - 2 * 60 * 1000),
              },
            });

            await this.prisma.client.message.create({
              data: {
                channelId: channel.id,
                userId: userId,
                content: `Agreed with Marcus on the contrast. I've updated the \`text-on-primary\` token to absolute white (#FFFFFF) instead of the off-white to ensure we hit the 7:1 ratio. I've also pushed a PR to the token repo for the web implementation.`,
                type: 'text',
                parentId: parentMsg.id,
                createdAt: new Date(baseTime - 1 * 60 * 1000),
              },
            });
          }
        }

        const taskCount = await this.prisma.client.task.count({ where: { channelId: channel.id } });
        if (taskCount === 0) {
          const sarah = await this.prisma.client.user.findUnique({ where: { email: 'sarah.jenkins@collabhq.com' } });
          const marcus = await this.prisma.client.user.findUnique({ where: { email: 'marcus.chen@collabhq.com' } });

          if (sarah && marcus) {
            await this.prisma.client.task.createMany({
              data: [
                {
                  channelId: channel.id,
                  createdBy: sarah.id,
                  assignedTo: marcus.id,
                  title: 'Finalize typography scale for mobile breakpoints',
                  status: 'todo',
                  priority: 'high',
                  position: 0,
                  aiSuggested: false,
                },
                {
                  channelId: channel.id,
                  createdBy: sarah.id,
                  assignedTo: sarah.id,
                  title: 'Audit existing color tokens against WCAG AAA',
                  status: 'todo',
                  priority: 'medium',
                  dueDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
                  position: 1,
                  aiSuggested: false,
                },
                {
                  channelId: channel.id,
                  createdBy: marcus.id,
                  title: 'Draft interaction guidelines for dropdown menus',
                  status: 'todo',
                  priority: 'low',
                  position: 2,
                  aiSuggested: false,
                },
              ],
            });
          }
        }
      }
    }
  }

  // Validates server-side if a user is a member of a channel
  async validateMembership(channelId: string, userId: string) {
    const member = await this.prisma.client.channelMember.findUnique({
      where: {
        channelId_userId: { channelId, userId },
      },
    });
    if (!member) {
      throw new ForbiddenException('You are not a member of this channel');
    }
    return member;
  }

  // Searches users within the same workspace to prevent global scraping
  async searchUsers(query: string, currentUserId: string) {
    const hasQuery = query && query.trim().length >= 1;

    // 1. Find all workspaces the current user is associated with
    const createdWorkspaces = await this.prisma.client.workspace.findMany({
      where: { createdBy: currentUserId },
      select: { id: true },
    });
    const createdIds = createdWorkspaces.map((w) => w.id);

    const channelMemberships = await this.prisma.client.channelMember.findMany({
      where: { userId: currentUserId },
      select: {
        channel: {
          select: { workspaceId: true },
        },
      },
    });
    const channelIds = channelMemberships.map((m) => m.channel.workspaceId);

    const workspaceIds = Array.from(new Set([...createdIds, ...channelIds]));

    // If user is not in any workspace, ensure/create default one
    if (workspaceIds.length === 0) {
      const defaultId = await this.ensureDefaultWorkspace(currentUserId);
      workspaceIds.push(defaultId);
    }

    // 2. Search for users who are also in those workspaces (or generally in the system if it's default)
    // To ensure a collaborative flow, we also fallback to searching all users if workspaces are default
    const isOnlyDefault = workspaceIds.length === 1;

    const whereClause: any = {
      AND: [
        { id: { not: currentUserId } },
      ],
    };

    if (hasQuery) {
      if (query.length === 1) {
        whereClause.AND.push({
          name: { startsWith: query }
        });
      } else {
        whereClause.AND.push({
          OR: [
            { name: { contains: query } },
            { email: { contains: query } },
          ],
        });
      }
    }

    if (!isOnlyDefault) {
      whereClause.AND.push({
        OR: [
          { workspacesCreated: { any: { id: { in: workspaceIds } } } },
          { channelMemberships: { any: { channel: { workspaceId: { in: workspaceIds } } } } },
        ],
      });
    }

    const users = await this.prisma.client.user.findMany({
      where: whereClause,
      take: 50,
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        role: true,
        status: true,
      },
    });

    if (!hasQuery) return users.slice(0, 15);

    const qLower = query.toLowerCase();

    const sortedUsers = users.sort((a, b) => {
      const aNameLower = a.name.toLowerCase();
      const bNameLower = b.name.toLowerCase();
      const aEmailLower = a.email.toLowerCase();
      const bEmailLower = b.email.toLowerCase();

      const getScore = (name: string, email: string) => {
        if (name === qLower) return 4;
        if (name.startsWith(qLower)) return 3;
        if (name.includes(qLower)) return 2;
        if (email.includes(qLower)) return 1;
        return 0;
      };

      const scoreA = getScore(aNameLower, aEmailLower);
      const scoreB = getScore(bNameLower, bEmailLower);

      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return aNameLower.localeCompare(bNameLower);
    });

    return sortedUsers.slice(0, 15);
  }

  // Returns or creates a deterministic DM channel between two users
  async getOrCreateDMChannel(userAId: string, userBId: string) {
    const dmKey = [userAId, userBId].sort().join('_');

    // Check if DM exists
    let channel = await this.prisma.client.channel.findUnique({
      where: { dmKey },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });

    if (channel) {
      return channel;
    }

    const workspaceId = await this.ensureDefaultWorkspace(userAId);

    try {
      channel = await this.prisma.client.channel.create({
        data: {
          workspaceId,
          name: `DM_${dmKey}`,
          type: 'dm',
          createdBy: userAId,
          dmKey,
          members: {
            create: [
              { userId: userAId, role: 'member' },
              { userId: userBId, role: 'member' },
            ],
          },
        },
        include: {
          members: {
            include: {
              user: true,
            },
          },
        },
      });
    } catch (err: any) {
      // Fallback for database race conditions (P2002 represents Unique constraint violation in Prisma)
      if (err.code === 'P2002') {
        const fallback = await this.prisma.client.channel.findUnique({
          where: { dmKey },
          include: {
            members: {
              include: {
                user: true,
              },
            },
          },
        });
        if (fallback) return fallback;
      }
      throw err;
    }

    return channel;
  }

  // Fetches all conversations/channels for a user
  async getConversations(userId: string, inMemoryOnlineUsers: Set<string>) {
    // Optimization: If the user is already a member of any channel/workspace, bypass the expensive default seeding logic
    const hasConversations = await this.prisma.client.channelMember.findFirst({
      where: { userId },
    });
    if (!hasConversations) {
      const workspaceId = await this.ensureDefaultWorkspace(userId);
      await this.ensureDefaultChannels(workspaceId, userId);
    }

    const memberships = await this.prisma.client.channelMember.findMany({
      where: { userId },
      include: {
        channel: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    avatarUrl: true,
                    role: true,
                    status: true,
                  },
                },
              },
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    const filteredMemberships = memberships.filter((m) => {
      const channel = m.channel;
      if (channel.type === 'dm' && channel.messages.length === 0) {
        return channel.createdBy === userId;
      }
      return true;
    });

    const channelIds = filteredMemberships.map((m) => m.channel.id);

    // 1. Batch fetch all messageRead records for this user in one query to avoid N+1 DB round-trips
    const lastReadRecords = await this.prisma.client.messageRead.findMany({
      where: {
        userId,
        channelId: { in: channelIds },
      },
    });

    const lastReadMap = new Map(lastReadRecords.map((r) => [r.channelId, r.lastReadAt]));

    const conversations = await Promise.all(
      filteredMemberships.map(async (m) => {
        const channel = m.channel;
        const lastMessageRecord = channel.messages[0] || null;

        // Query latest reaction in this channel
        const latestReaction = await this.prisma.client.messageReaction.findFirst({
          where: { message: { channelId: channel.id } },
          orderBy: { createdAt: 'desc' },
          include: {
            message: true,
          },
        });

        let isReactionNewer = false;
        if (latestReaction) {
          if (!lastMessageRecord || latestReaction.createdAt.getTime() > lastMessageRecord.createdAt.getTime()) {
            isReactionNewer = true;
          }
        }

        // 2. Short-circuit unread checks: only run database count if there are actual new unread messages
        const lastReadAt = lastReadMap.get(channel.id) || new Date(0);
        let unreadCount = 0;

        if (lastMessageRecord && lastMessageRecord.userId !== userId) {
          const lastMessageTime = new Date(lastMessageRecord.createdAt).getTime();
          if (lastMessageTime > lastReadAt.getTime()) {
            unreadCount = await this.prisma.client.message.count({
              where: {
                channelId: channel.id,
                createdAt: {
                  gt: lastReadAt,
                },
                userId: { not: userId }, // do not count own messages as unread
                deletedAt: null,
              },
            });
          }
        }

        // If reaction is newer and unread
        if (isReactionNewer && latestReaction && latestReaction.userId !== userId) {
          if (latestReaction.createdAt.getTime() > lastReadAt.getTime()) {
            if (unreadCount === 0) {
              unreadCount = 1;
            }
          }
        }

        // Determine names and avatars based on DM vs Group
        let name = channel.name;
        let avatar: string | null = null;
        let role = '';
        let statusText = '';
        let isOnline = false;

        if (channel.type === 'dm') {
          const otherMember = channel.members.find((member) => member.userId !== userId);
          if (otherMember && otherMember.user) {
            name = otherMember.user.name;
            avatar = otherMember.user.avatarUrl;
            role = otherMember.user.role || '';
            isOnline = inMemoryOnlineUsers.has(otherMember.userId);
            statusText = isOnline ? 'Active now' : 'Offline';
          }
        }

        // Get initials for display fallback
        const initials = name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);

        let lastMessage = '';
        if (lastMessageRecord) {
          lastMessage = lastMessageRecord.deletedAt ? 'this message was deleted' : lastMessageRecord.content;
        }
        let lastMessageTime = lastMessageRecord
          ? new Date(lastMessageRecord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        let lastMessageAtStr = lastMessageRecord
          ? lastMessageRecord.createdAt.toISOString()
          : channel.createdAt.toISOString();

        if (isReactionNewer && latestReaction) {
          if (latestReaction.message.deletedAt) {
            lastMessage = 'this message was deleted';
          } else {
            lastMessage = `Reacted ${latestReaction.emoji} to "${latestReaction.message.content}"`;
          }
          lastMessageTime = new Date(latestReaction.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          lastMessageAtStr = latestReaction.createdAt.toISOString();
        }

        let lastMessageId = lastMessageRecord ? lastMessageRecord.id : undefined;

        let lastSenderId: string | undefined = undefined;
        if (isReactionNewer && latestReaction) {
          lastSenderId = latestReaction.userId;
        } else if (lastMessageRecord) {
          lastSenderId = lastMessageRecord.userId;
        }

        return {
          id: channel.id,
          name,
          avatar,
          initials,
          role,
          statusText,
          type: channel.type === 'dm' ? 'direct' : channel.type === 'group' ? 'group' : 'channel',
          lastMessage,
          lastMessageId,
          lastMessageTime,
          lastMessageAt: lastMessageAtStr,
          lastSenderId,
          unreadCount,
          isOnline,
          participants: channel.members.map((member) => ({
            id: member.userId,
            name: member.user.name,
            avatar: member.user.avatarUrl || undefined,
            initials: member.user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2),
            role: member.user.role || '',
            isOnline: inMemoryOnlineUsers.has(member.userId),
          })),
        };
      }),
    );

    // Sort by latest message or creation time
    return conversations.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  // Cursor-based message pagination to prevent memory bloating
  async getMessages(channelId: string, userId: string, cursor?: string, limit = 20) {
    await this.validateMembership(channelId, userId);

    const rawMessages = await this.prisma.client.message.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Fetch 1 extra to check if there is more data
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
        files: true,
        messageReactions: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    const hasMore = rawMessages.length > limit;
    const messagesToReturn = hasMore ? rawMessages.slice(0, limit) : rawMessages;

    // The cursor for the next page is the ID of the oldest message in the set
    const nextCursor = messagesToReturn.length > 0 ? messagesToReturn[messagesToReturn.length - 1].id : null;

    const formatBytes = (bytes: number) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Map to frontend message structure (reverse to restore chronological order)
    const formattedMessages = messagesToReturn
      .map((msg) => {
        const file = msg.files[0] || null;

        // Group reactions by emoji
        const reactionGroupMap = new Map<string, { emoji: string; count: number; users: string[]; userIds: string[]; hasReacted: boolean }>();
        for (const rx of msg.messageReactions || []) {
          const key = rx.emoji;
          if (!reactionGroupMap.has(key)) {
            reactionGroupMap.set(key, {
              emoji: key,
              count: 0,
              users: [],
              userIds: [],
              hasReacted: false,
            });
          }
          const group = reactionGroupMap.get(key)!;
          group.count += 1;
          group.users.push(rx.user.name);
          group.userIds.push(rx.userId);
          if (rx.userId === userId) {
            group.hasReacted = true;
          }
        }

        return {
          id: msg.id,
          text: msg.content,
          senderId: msg.userId,
          senderName: msg.user.name,
          senderAvatar: msg.user.avatarUrl || undefined,
          timestamp: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          createdAt: msg.createdAt.toISOString(),
          editedAt: msg.editedAt ? msg.editedAt.toISOString() : undefined,
          isSelf: msg.userId === userId,
          parentId: msg.parentId || undefined,
          isPinned: msg.isPinned,
          reactions: Array.from(reactionGroupMap.values()),
          attachment: file ? {
            name: file.name,
            size: formatBytes(Number(file.sizeBytes)),
            type: file.mimeType.includes('pdf') ? 'pdf' : file.mimeType.includes('image') ? 'image' : 'other',
          } : undefined,
          isDeleted: msg.deletedAt !== null,
          isSystem: msg.type === 'system',
        };
      })
      .reverse();

    return {
      messages: formattedMessages,
      nextCursor,
      hasMore,
    };
  }

  // Saves a new message to the database
  async saveMessage(channelId: string, senderId: string, content: string, parentId?: string) {
    await this.validateMembership(channelId, senderId);

    const message = await this.prisma.client.message.create({
      data: {
        channelId,
        userId: senderId,
        content,
        type: 'text',
        parentId: parentId || null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Update the message_reads for the sender automatically
    await this.updateLastRead(channelId, senderId);

    return message;
  }

  // Updates the read pointer for the user on a channel
  async updateLastRead(channelId: string, userId: string) {
    await this.validateMembership(channelId, userId);

    const result = await this.prisma.client.messageRead.upsert({
      where: {
        userId_channelId: { userId, channelId },
      },
      update: {
        lastReadAt: new Date(),
      },
      create: {
        userId,
        channelId,
        lastReadAt: new Date(),
      },
    });
    return result;
  }

  // --- TASK MANAGEMENT ENDPOINTS ---

  async getTasks(channelId: string, userId: string) {
    await this.validateMembership(channelId, userId);
    const tasks = await this.prisma.client.task.findMany({
      where: { channelId, deletedAt: null },
      orderBy: { position: 'asc' },
      include: {
        sprint: true,
        assignee: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
          },
        },
      },
    });
    return tasks.map(task => ({
      ...task,
      sprint: task.sprint ? task.sprint.name : null,
    }));
  }

  async createTask(
    channelId: string,
    creatorId: string,
    body: { title: string; priority: string; assignedToEmail?: string; assignedTo?: string; dueDate?: string; sprint?: string },
  ) {
    await this.validateMembership(channelId, creatorId);

    let assigneeId: string | undefined = undefined;
    if (body.assignedTo) {
      assigneeId = body.assignedTo;
    } else if (body.assignedToEmail) {
      const user = await this.prisma.client.user.findUnique({
        where: { email: body.assignedToEmail },
      });
      if (user) assigneeId = user.id;
    }

    const maxTask = await this.prisma.client.task.findFirst({
      where: { channelId },
      orderBy: { position: 'desc' },
    });
    const position = maxTask ? maxTask.position + 1 : 0;

    let sprintId: string | null = null;
    if (body.sprint) {
      const project = await this.prisma.client.project.findFirst({
        where: { channelId },
      });
      if (project) {
        let sprintRecord = await this.prisma.client.sprint.findFirst({
          where: { projectId: project.id, name: body.sprint },
        });
        if (!sprintRecord) {
          sprintRecord = await this.prisma.client.sprint.create({
            data: {
              name: body.sprint,
              projectId: project.id,
              status: 'active',
            },
          });
        }
        sprintId = sprintRecord.id;
      }
    }

    const task = await this.prisma.client.task.create({
      data: {
        channelId,
        createdBy: creatorId,
        title: body.title,
        status: 'todo',
        priority: (body.priority || 'medium') as any,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        assignedTo: assigneeId,
        position,
        aiSuggested: false,
        sprintId,
      },
      include: {
        sprint: true,
        assignee: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
          },
        },
      },
    });

    return {
      ...task,
      sprint: task.sprint ? task.sprint.name : null,
    };
  }

  async updateTask(
    taskId: string,
    userId: string,
    body: { status?: string; title?: string; priority?: string; assignedTo?: string; dueDate?: string | null; sprint?: string | null },
  ) {
    const task = await this.prisma.client.task.findUnique({
      where: { id: taskId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    await this.validateMembership(task.channelId, userId);

    const updateData: any = {};
    if (body.status !== undefined) updateData.status = body.status;
    if (body.title !== undefined) updateData.title = body.title;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.assignedTo !== undefined) updateData.assignedTo = body.assignedTo;
    if (body.dueDate !== undefined) updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    
    if (body.sprint !== undefined) {
      if (body.sprint === null || body.sprint === '') {
        updateData.sprintId = null;
      } else {
        let projectId = task.projectId;
        if (!projectId) {
          const project = await this.prisma.client.project.findFirst({
            where: { channelId: task.channelId },
          });
          if (project) projectId = project.id;
        }
        if (projectId) {
          let sprintRecord = await this.prisma.client.sprint.findFirst({
            where: { projectId, name: body.sprint },
          });
          if (!sprintRecord) {
            sprintRecord = await this.prisma.client.sprint.create({
              data: {
                name: body.sprint,
                projectId,
                status: 'active',
              },
            });
          }
          updateData.sprintId = sprintRecord.id;
        } else {
          updateData.sprintId = null;
        }
      }
    }

    const updatedTask = await this.prisma.client.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        sprint: true,
        assignee: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
          },
        },
      },
    });

    return {
      ...updatedTask,
      sprint: updatedTask.sprint ? updatedTask.sprint.name : null,
    };
  }

  async createChannel(
    userId: string,
    body: { name: string; description?: string; type: 'public' | 'private'; memberIds?: string[] },
  ) {
    const workspaceId = await this.ensureDefaultWorkspace(userId);

    const channel = await this.prisma.client.channel.create({
      data: {
        workspaceId,
        name: body.name,
        description: body.description || null,
        type: body.type,
        createdBy: userId,
        members: {
          create: {
            userId,
            role: 'admin',
          },
        },
      },
    });

    if (body.memberIds && body.memberIds.length > 0) {
      const uniqueMemberIds = Array.from(new Set(body.memberIds.filter(id => id !== userId)));
      if (uniqueMemberIds.length > 0) {
        await this.prisma.client.channelMember.createMany({
          data: uniqueMemberIds.map((memberId) => ({
            channelId: channel.id,
            userId: memberId,
            role: 'member',
          })),
          skipDuplicates: true,
        });
      }
    }

    return this.prisma.client.channel.findUnique({
      where: { id: channel.id },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });
  }

  async createGroupChat(userId: string, body: { name: string; memberIds: string[] }) {
    const workspaceId = await this.ensureDefaultWorkspace(userId);

    const channel = await this.prisma.client.channel.create({
      data: {
        workspaceId,
        name: body.name,
        type: 'group',
        createdBy: userId,
        members: {
          create: {
            userId,
            role: 'admin',
          },
        },
      },
    });

    const uniqueMemberIds = Array.from(new Set(body.memberIds.filter(id => id !== userId)));
    if (uniqueMemberIds.length > 0) {
      await this.prisma.client.channelMember.createMany({
        data: uniqueMemberIds.map((memberId) => ({
          channelId: channel.id,
          userId: memberId,
          role: 'member',
        })),
        skipDuplicates: true,
      });
    }

    return this.prisma.client.channel.findUnique({
      where: { id: channel.id },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });
  }

  async addMembersToChannel(userId: string, channelId: string, memberIds: string[]) {
    const channel = await this.prisma.client.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    await this.validateMembership(channelId, userId);

    const uniqueMemberIds = Array.from(new Set(memberIds));
    let systemMessage: any = null;

    if (uniqueMemberIds.length > 0) {
      await this.prisma.client.channelMember.createMany({
        data: uniqueMemberIds.map((id) => ({
          channelId,
          userId: id,
          role: 'member',
        })),
        skipDuplicates: true,
      });

      try {
        const addedUsers = await this.prisma.client.user.findMany({
          where: { id: { in: uniqueMemberIds } },
          select: { name: true },
        });
        const adder = await this.prisma.client.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });

        if (addedUsers.length > 0 && adder) {
          const names = addedUsers.map((u) => u.name).join(', ');
          const systemText = `${adder.name} added ${names}`;

          systemMessage = await this.prisma.client.message.create({
            data: {
              channelId,
              userId,
              content: systemText,
              type: 'system',
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatarUrl: true,
                },
              },
            },
          });
        }
      } catch (err) {
        console.error('Failed to create system message for added members', err);
      }
    }

    const updatedChannel = await this.prisma.client.channel.findUnique({
      where: { id: channelId },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });

    return {
      channel: updatedChannel,
      systemMessage,
    };
  }

  async toggleMessagePin(messageId: string, userId: string) {
    const message = await this.prisma.client.message.findUnique({
      where: { id: messageId },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    await this.validateMembership(message.channelId, userId);

    const updated = await this.prisma.client.message.update({
      where: { id: messageId },
      data: { isPinned: !message.isPinned },
    });

    return updated;
  }

  async toggleMessageReaction(messageId: string, userId: string, emoji: string) {
    const message = await this.prisma.client.message.findUnique({
      where: { id: messageId },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    await this.validateMembership(message.channelId, userId);

    // Fetch all reactions by this user on this message to avoid database emoji collation issues
    const userReactions = await this.prisma.client.messageReaction.findMany({
      where: {
        messageId,
        userId,
      },
    });

    const existing = userReactions.find((r) => r.emoji === emoji);

    // Delete all current reactions by this user on this message to maintain single reaction rule
    await this.prisma.client.messageReaction.deleteMany({
      where: {
        messageId,
        userId,
      },
    });

    // If the clicked reaction didn't already exist, create it (standard toggle behavior)
    if (!existing) {
      await this.prisma.client.messageReaction.create({
        data: {
          messageId,
          userId,
          emoji,
        },
      });
    }

    // Return the updated reactions grouped by emoji
    const allReactions = await this.prisma.client.messageReaction.findMany({
      where: { messageId },
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    const reactionGroupMap = new Map<string, { emoji: string; count: number; users: string[]; userIds: string[]; hasReacted: boolean }>();
    for (const rx of allReactions) {
      const key = rx.emoji;
      if (!reactionGroupMap.has(key)) {
        reactionGroupMap.set(key, {
          emoji: key,
          count: 0,
          users: [],
          userIds: [],
          hasReacted: false,
        });
      }
      const group = reactionGroupMap.get(key)!;
      group.count += 1;
      group.users.push(rx.user.name);
      group.userIds.push(rx.userId);
      if (rx.userId === userId) {
        group.hasReacted = true;
      }
    }

    return {
      channelId: message.channelId,
      reactions: Array.from(reactionGroupMap.values()).sort((a, b) => a.emoji.localeCompare(b.emoji)),
    };
  }

  async deleteMessage(messageId: string, userId: string) {
    const message = await this.prisma.client.message.findUnique({
      where: { id: messageId },
      include: { channel: true },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    await this.validateMembership(message.channelId, userId);

    if (message.channel.type === 'dm') {
      throw new ForbiddenException('Delete for Me is handled on the client for one-to-one chats');
    }

    if (message.userId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    const updated = await this.prisma.client.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), isPinned: false },
    });

    return updated;
  }

  async editMessage(messageId: string, content: string, userId: string) {
    const message = await this.prisma.client.message.findUnique({
      where: { id: messageId },
      include: { channel: true },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    await this.validateMembership(message.channelId, userId);

    if (message.userId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }
    if (message.deletedAt) {
      throw new BadRequestException('Cannot edit a deleted message');
    }

    const updated = await this.prisma.client.message.update({
      where: { id: messageId },
      data: {
        content,
        editedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    return {
      id: updated.id,
      text: updated.content,
      senderId: updated.userId,
      senderName: updated.user.name,
      senderAvatar: updated.user.avatarUrl || undefined,
      timestamp: new Date(updated.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: updated.createdAt.toISOString(),
      editedAt: updated.editedAt ? updated.editedAt.toISOString() : undefined,
      isSelf: false,
      channelId: updated.channelId,
      parentId: updated.parentId || undefined,
      isSystem: false,
    };
  }

  // --- PROJECT MANAGEMENT SERVICES ---

  async getProjects(userId: string) {
    const workspaceId = await this.ensureDefaultWorkspace(userId);

    const projects = await this.prisma.client.project.findMany({
      where: {
        workspaceId,
        OR: [
          { createdBy: userId },
          {
            channel: {
              members: {
                some: {
                  userId: userId,
                },
              },
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        channel: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
        tasks: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
          },
        },
        sprints: true,
      },
    });

    return projects.map((p) => {
      const totalTasks = p.tasks.length;
      const completedTasks = p.tasks.filter((t) => t.status === 'done').length;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      const members = p.channel
        ? p.channel.members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          avatarUrl: m.user.avatarUrl,
        }))
        : [];

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        color: p.color,
        status: p.status,
        dueDate: p.dueDate ? p.dueDate.toISOString() : null,
        securityLevel: p.securityLevel,
        createdAt: p.createdAt.toISOString(),
        progress,
        totalTasks,
        completedTasks,
        members,
        channelId: p.channelId,
        creator: p.creator,
        sprints: p.sprints.map(s => ({
          name: s.name,
          startDate: s.startDate ? s.startDate.toISOString() : null,
          endDate: s.endDate ? s.endDate.toISOString() : null,
          status: s.status,
        })),
      };
    });
  }

  async createProject(
    userId: string,
    body: { name: string; description?: string; dueDate?: string; securityLevel?: string; invitedEmails?: string[] },
  ) {
    const workspaceId = await this.ensureDefaultWorkspace(userId);

    const invitedUsers: any[] = [];
    if (body.invitedEmails && body.invitedEmails.length > 0) {
      const users = await this.prisma.client.user.findMany({
        where: { email: { in: body.invitedEmails } },
      });
      invitedUsers.push(...users);
    }

    const allMemberIds = Array.from(
      new Set([userId, ...invitedUsers.map((u) => u.id)]),
    );

    const channelName = `project-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const channel = await this.prisma.client.channel.create({
      data: {
        workspaceId,
        name: channelName,
        description: body.description || `Discussion channel for project ${body.name}`,
        type: 'private',
        createdBy: userId,
        members: {
          create: allMemberIds.map((mId) => ({
            userId: mId,
            role: mId === userId ? 'admin' : 'member',
          })),
        },
      },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });

    const project = await this.prisma.client.project.create({
      data: {
        workspaceId,
        channelId: channel.id,
        name: body.name,
        description: body.description || null,
        color: '#3250d5',
        status: 'active',
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        securityLevel: body.securityLevel || 'Standard (Internal)',
        createdBy: userId,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      status: project.status,
      dueDate: project.dueDate ? project.dueDate.toISOString() : null,
      securityLevel: project.securityLevel,
      createdAt: project.createdAt.toISOString(),
      progress: 0,
      totalTasks: 0,
      completedTasks: 0,
      members: channel.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
      })),
      channelId: project.channelId,
      creator: project.creator,
    };
  }

  async updateProject(
    projectId: string,
    userId: string,
    body: { name?: string; description?: string; dueDate?: string; securityLevel?: string; status?: 'active' | 'archived' },
  ) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Validate project membership (must be project creator or member of project's channel)
    const isMemberOrCreator =
      project.createdBy === userId ||
      (project.channelId &&
        (await this.prisma.client.channelMember.findUnique({
          where: {
            channelId_userId: {
              channelId: project.channelId,
              userId,
            },
          },
        })));

    if (!isMemberOrCreator) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.dueDate !== undefined) updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.securityLevel !== undefined) updateData.securityLevel = body.securityLevel;
    if (body.status !== undefined) updateData.status = body.status;

    const updated = await this.prisma.client.project.update({
      where: { id: projectId },
      data: updateData,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
        channel: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
        tasks: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    const totalTasks = updated.tasks.length;
    const completedTasks = updated.tasks.filter((t) => t.status === 'done').length;
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const members = updated.channel
      ? updated.channel.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
      }))
      : [];

    return {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      color: updated.color,
      status: updated.status,
      dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
      securityLevel: updated.securityLevel,
      createdAt: updated.createdAt.toISOString(),
      progress,
      totalTasks,
      completedTasks,
      members,
      channelId: updated.channelId,
      creator: updated.creator,
    };
  }

  async deleteProject(projectId: string, userId: string) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.createdBy !== userId) {
      throw new ForbiddenException('Only the creator of this project can delete it');
    }

    await this.prisma.client.project.delete({
      where: { id: projectId },
    });

    if (project.channelId) {
      await this.prisma.client.channel.delete({
        where: { id: project.channelId },
      }).catch((err) => {
        console.error('Failed to delete channel for project', err);
      });
    }

    return { success: true };
  }

  async createSprint(
    projectId: string,
    userId: string,
    body: { name: string; startDate?: string; endDate?: string },
  ) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const existing = await this.prisma.client.sprint.findFirst({
      where: { projectId, name: body.name },
    });
    if (existing) {
      throw new BadRequestException('Sprint name already exists in this project');
    }

    const sprint = await this.prisma.client.sprint.create({
      data: {
        name: body.name,
        projectId,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        status: 'active',
      },
    });

    return {
      name: sprint.name,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      endDate: sprint.endDate ? sprint.endDate.toISOString() : null,
      status: sprint.status,
    };
  }

  async deleteSprint(projectId: string, sprintName: string, userId: string) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const sprint = await this.prisma.client.sprint.findFirst({
      where: { projectId, name: sprintName },
    });
    if (!sprint) {
      throw new NotFoundException('Sprint not found');
    }

    await this.prisma.client.task.updateMany({
      where: { sprintId: sprint.id },
      data: { sprintId: null },
    });

    await this.prisma.client.sprint.delete({
      where: { id: sprint.id },
    });

    return { success: true };
  }

  async updateSprint(projectId: string, sprintName: string, status: string, userId: string) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const sprint = await this.prisma.client.sprint.findFirst({
      where: { projectId, name: sprintName },
    });
    if (!sprint) {
      throw new NotFoundException('Sprint not found');
    }

    const updated = await this.prisma.client.sprint.update({
      where: { id: sprint.id },
      data: { status },
    });

    return {
      name: updated.name,
      startDate: updated.startDate ? updated.startDate.toISOString() : null,
      endDate: updated.endDate ? updated.endDate.toISOString() : null,
      status: updated.status,
    };
  }

  async removeProjectMember(projectId: string, memberId: string, currentUserId: string) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!project.channelId) {
      throw new BadRequestException('Project has no associated channel');
    }

    // Permission check: only the project creator or a channel admin can remove a member
    const isCreator = project.createdBy === currentUserId;
    const channelMember = await this.prisma.client.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId: project.channelId,
          userId: currentUserId,
        },
      },
    });

    const isChannelAdmin = channelMember?.role === 'admin';

    if (!isCreator && !isChannelAdmin) {
      throw new ForbiddenException('You do not have permission to remove members from this project');
    }

    // Verify target user is actually a member of the project's channel
    const targetMember = await this.prisma.client.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId: project.channelId,
          userId: memberId,
        },
      },
    });

    if (!targetMember) {
      throw new NotFoundException('Member is not part of this project');
    }

    // Cannot remove the project creator
    if (memberId === project.createdBy) {
      throw new BadRequestException('Cannot remove the project creator');
    }

    // Delete membership
    await this.prisma.client.channelMember.delete({
      where: {
        channelId_userId: {
          channelId: project.channelId,
          userId: memberId,
        },
      },
    });

    let systemMessage: any = null;
    try {
      const removedUser = await this.prisma.client.user.findUnique({
        where: { id: memberId },
        select: { name: true },
      });
      const remover = await this.prisma.client.user.findUnique({
        where: { id: currentUserId },
        select: { name: true },
      });

      if (removedUser && remover) {
        const systemText = `${remover.name} removed ${removedUser.name} from the project`;
        systemMessage = await this.prisma.client.message.create({
          data: {
            channelId: project.channelId,
            userId: currentUserId,
            content: systemText,
            type: 'system',
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
              },
            },
          },
        });
      }
    } catch (err) {
      console.error('Failed to create system message for removed project member', err);
    }

    return { success: true, channelId: project.channelId, systemMessage };
  }


  async deleteTask(taskId: string, userId: string) {
    const task = await this.prisma.client.task.findUnique({
      where: { id: taskId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    await this.validateMembership(task.channelId, userId);

    return this.prisma.client.task.update({
      where: { id: taskId },
      data: { deletedAt: new Date() },
    });
  }

  async searchProjects(userId: string, workspaceId: string, query?: string, limit = 20, page = 1) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;

    const whereClause: any = {
      workspaceId,
      OR: [
        { createdBy: userId },
        {
          channel: {
            members: {
              some: { userId },
            },
          },
        },
      ],
    };

    if (query && query.trim()) {
      whereClause.name = { contains: query };
    }

    return this.prisma.client.project.findMany({
      where: whereClause,
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        channel: { select: { id: true, name: true } },
      },
    });
  }

  async getProjectByIdOrName(userId: string, workspaceId: string, idOrName: string) {
    const project = await this.prisma.client.project.findFirst({
      where: {
        workspaceId,
        OR: [
          { id: idOrName },
          { name: idOrName },
        ],
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        channel: {
          include: {
            members: {
              include: {
                user: { select: { id: true, name: true, email: true, avatarUrl: true } },
              },
            },
          },
        },
        tasks: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
          include: {
            assignee: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID/Name "${idOrName}" not found in this workspace.`);
    }

    const isCreator = project.createdBy === userId;
    const isMember = project.channel?.members.some(m => m.userId === userId);
    if (!isCreator && !isMember) {
      throw new ForbiddenException(`You do not have access to this project.`);
    }

    return project;
  }

  async searchTasks(userId: string, workspaceId: string, query?: string, projectId?: string, limit = 20, page = 1) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;

    const whereClause: any = {
      deletedAt: null,
      channel: {
        workspaceId,
        members: {
          some: { userId },
        },
      },
    };

    if (projectId) {
      whereClause.projectId = projectId;
    }

    if (query && query.trim()) {
      whereClause.title = { contains: query };
    }

    return this.prisma.client.task.findMany({
      where: whereClause,
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async createTaskInProject(
    userId: string,
    workspaceId: string,
    projectName: string,
    title: string,
    description?: string,
    priority?: string,
    dueDate?: string,
  ) {
    const project = await this.prisma.client.project.findFirst({
      where: {
        workspaceId,
        name: { contains: projectName },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project "${projectName}" not found in this workspace.`);
    }

    if (!project.channelId) {
      throw new BadRequestException(`Project "${projectName}" does not have an associated channel.`);
    }

    const task = await this.createTask(project.channelId, userId, {
      title,
      priority: (priority || 'medium') as any,
      dueDate,
    });

    const updateData: any = { projectId: project.id };
    if (description) {
      updateData.description = description;
    }

    return this.prisma.client.task.update({
      where: { id: task.id },
      data: updateData,
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }

  async closeTaskByName(userId: string, workspaceId: string, taskTitle: string, projectName?: string) {
    const whereClause: any = {
      title: { contains: taskTitle },
      deletedAt: null,
      status: { not: 'done' },
      channel: {
        workspaceId,
        members: {
          some: { userId },
        },
      },
    };

    if (projectName) {
      whereClause.project = {
        name: { contains: projectName },
      };
    }

    const task = await this.prisma.client.task.findFirst({
      where: whereClause,
    });

    if (!task) {
      throw new NotFoundException(
        `Active task matching "${taskTitle}" ${projectName ? `in project "${projectName}"` : ''} not found in this workspace.`
      );
    }

    return this.updateTask(task.id, userId, { status: 'done' });
  }

  async searchWorkspaceUsers(userId: string, workspaceId: string, query?: string, limit = 20, page = 1) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;

    const whereClause: any = {
      channelMemberships: {
        some: {
          channel: {
            workspaceId,
          },
        },
      },
    };

    if (query && query.trim()) {
      whereClause.OR = [
        { name: { contains: query } },
        { email: { contains: query } },
      ];
    }

    return this.prisma.client.user.findMany({
      where: whereClause,
      take,
      skip,
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        role: true,
        status: true,
        lastSeenAt: true,
      },
    });
  }

  async scheduleMessage(
    userId: string,
    workspaceId: string,
    targetName: string,
    isGroup: boolean,
    content: string,
    scheduledTimeStr: string,
  ) {
    const scheduledAt = new Date(scheduledTimeStr);
    if (isNaN(scheduledAt.getTime())) {
      throw new BadRequestException(`Invalid scheduled date-time: "${scheduledTimeStr}"`);
    }

    let targetChannelId: string | null = null;
    let recipientUser: any = null;

    if (isGroup) {
      const channel = await this.prisma.client.channel.findFirst({
        where: {
          workspaceId,
          name: { contains: targetName },
        },
      });
      if (!channel) {
        throw new NotFoundException(`Channel "${targetName}" not found in this workspace.`);
      }
      targetChannelId = channel.id;
    } else {
      recipientUser = await this.prisma.client.user.findFirst({
        where: {
          OR: [
            { name: { contains: targetName } },
            { email: { contains: targetName } },
          ],
          channelMemberships: {
            some: {
              channel: { workspaceId },
            },
          },
        },
      });
      if (!recipientUser) {
        throw new NotFoundException(`User "${targetName}" not found in this workspace.`);
      }

      const dmChannel = await this.getOrCreateDMChannel(userId, recipientUser.id);
      targetChannelId = dmChannel.id;
    }

    return this.prisma.client.scheduledMessage.create({
      data: {
        channelId: targetChannelId,
        userId,
        scheduledBy: userId,
        createdViaAI: true,
        content,
        scheduledAt,
        timezone: 'UTC',
      },
      include: {
        channel: { select: { id: true, name: true, type: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }
}

