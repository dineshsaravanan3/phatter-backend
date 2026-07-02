import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  Req,
  UseGuards,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Get('users/search')
  @ApiOperation({ summary: 'Search users to start a chat' })
  async searchUsers(@Query('q') query: string, @Req() req: any) {
    return this.chatService.searchUsers(query || '', req.user.id);
  }

  @Post('dm')
  @ApiOperation({ summary: 'Get or create a DM channel with a user' })
  async getOrCreateDM(
    @Body('targetUserId') targetUserId: string,
    @Req() req: any,
  ) {
    if (!targetUserId) {
      throw new BadRequestException('Target user ID is required');
    }
    const channel = await this.chatService.getOrCreateDMChannel(
      req.user.id,
      targetUserId,
    );
    // Do not broadcast conversation:created for direct messages to avoid premature empty conversation loading on target user's screen.
    // The conversation will show up for target user on their first message event.
    return channel;
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Get all active chats and channels' })
  async getConversations(@Req() req: any) {
    const onlineUsers = this.chatGateway.getOnlineUsers();
    return this.chatService.getConversations(req.user.id, onlineUsers);
  }

  @Get('channels/:channelId/messages')
  @ApiOperation({
    summary: 'Get messages for a channel with cursor pagination',
  })
  async getMessages(
    @Param('channelId') channelId: string,
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
    @Req() req: any,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.chatService.getMessages(
      channelId,
      req.user.id,
      cursor,
      parsedLimit,
    );
  }

  @Post('channels/:channelId/messages')
  @ApiOperation({ summary: 'Post a new message to a channel' })
  async postMessage(
    @Param('channelId') channelId: string,
    @Body('content') content: string,
    @Body('tempId') tempId: string,
    @Body('parentId') parentId: string,
    @Body('mentionedUserIds') mentionedUserIds: string[],
    @Req() req: any,
  ) {
    if (!content || !content.trim()) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const message = await this.chatService.saveMessage(
      channelId,
      req.user.id,
      content,
      parentId,
    );

    // Format the response structure to match the frontend expectations
    const formattedMessage = {
      id: message.id,
      text: message.content,
      senderId: message.userId,
      senderName: message.user.name,
      senderAvatar: message.user.avatarUrl || undefined,
      timestamp: new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      createdAt: message.createdAt.toISOString(),
      isSelf: false, // Recipients see it as not self
      channelId,
      parentId: message.parentId || undefined,
      isSystem: false,
    };

    // Broadcast the message via WebSockets to all connected clients in the room
    this.chatGateway.broadcastNewMessage(channelId, formattedMessage, tempId, mentionedUserIds);

    // Return the message with isSelf = true for the poster
    return {
      ...formattedMessage,
      isSelf: true,
    };
  }

  @Patch('channels/:channelId/read')
  @ApiOperation({ summary: 'Mark messages in a channel as read' })
  async markRead(@Param('channelId') channelId: string, @Req() req: any) {
    await this.chatService.updateLastRead(channelId, req.user.id);
    return { success: true };
  }

  // --- TASK ENDPOINTS ---

  @Get('channels/:channelId/tasks')
  @ApiOperation({ summary: 'Get tasks assigned to a channel' })
  async getTasks(@Param('channelId') channelId: string, @Req() req: any) {
    return this.chatService.getTasks(channelId, req.user.id);
  }

  @Post('channels/:channelId/tasks')
  @ApiOperation({ summary: 'Create a task in a channel' })
  async createTask(
    @Param('channelId') channelId: string,
    @Body()
    body: {
      title: string;
      priority: string;
      assignedToEmail?: string;
      assignedTo?: string;
      dueDate?: string;
      sprint?: string;
    },
    @Req() req: any,
  ) {
    return this.chatService.createTask(channelId, req.user.id, body);
  }

  @Patch('tasks/:taskId')
  @ApiOperation({
    summary: 'Update task properties or toggle completion status',
  })
  async updateTask(
    @Param('taskId') taskId: string,
    @Body()
    body: {
      status?: string;
      title?: string;
      priority?: string;
      assignedTo?: string;
      dueDate?: string | null;
      sprint?: string | null;
    },
    @Req() req: any,
  ) {
    return this.chatService.updateTask(taskId, req.user.id, body);
  }

  @Post('channel')
  @ApiOperation({ summary: 'Create a public/private channel' })
  async createChannel(
    @Body()
    body: {
      name: string;
      description?: string;
      type: 'public' | 'private';
      memberIds?: string[];
    },
    @Req() req: any,
  ) {
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException('Channel name is required');
    }
    if (body.type !== 'public' && body.type !== 'private') {
      throw new BadRequestException('Channel type must be public or private');
    }
    const channel = await this.chatService.createChannel(req.user.id, body);
    this.chatGateway.broadcastNewConversation(channel);
    return channel;
  }

  @Post('group')
  @ApiOperation({ summary: 'Create a group chat' })
  async createGroupChat(
    @Body() body: { name: string; memberIds: string[] },
    @Req() req: any,
  ) {
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException('Group chat name is required');
    }
    if (
      !body.memberIds ||
      !Array.isArray(body.memberIds) ||
      body.memberIds.length === 0
    ) {
      throw new BadRequestException('At least one member must be invited');
    }
    const channel = await this.chatService.createGroupChat(req.user.id, body);
    this.chatGateway.broadcastNewConversation(channel);
    return channel;
  }

  @Post('channel/:id/members')
  @ApiOperation({ summary: 'Add members to a channel or group chat' })
  async addMembers(
    @Param('id') channelId: string,
    @Body('memberIds') memberIds: string[],
    @Req() req: any,
  ) {
    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      throw new BadRequestException('memberIds must be a non-empty array');
    }
    const { channel, systemMessage } =
      await this.chatService.addMembersToChannel(
        req.user.id,
        channelId,
        memberIds,
      );
    this.chatGateway.broadcastNewConversation(channel);

    if (systemMessage) {
      const formattedMessage = {
        id: systemMessage.id,
        text: systemMessage.content,
        senderId: systemMessage.userId,
        senderName: systemMessage.user.name,
        senderAvatar: systemMessage.user.avatarUrl || undefined,
        timestamp: new Date(systemMessage.createdAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        createdAt: systemMessage.createdAt.toISOString(),
        isSelf: false,
        channelId,
        isSystem: true,
      };
      this.chatGateway.broadcastNewMessage(channelId, formattedMessage);
    }

    return channel;
  }

  @Patch('messages/:messageId/pin')
  @ApiOperation({ summary: 'Pin or unpin a message' })
  async togglePin(@Param('messageId') messageId: string, @Req() req: any) {
    const updated = await this.chatService.toggleMessagePin(
      messageId,
      req.user.id,
    );
    this.chatGateway.broadcastMessagePin(
      updated.channelId,
      messageId,
      updated.isPinned,
    );
    return updated;
  }

  @Post('messages/:messageId/react')
  @ApiOperation({ summary: 'React or remove reaction from a message' })
  async toggleReaction(
    @Param('messageId') messageId: string,
    @Body('emoji') emoji: string,
    @Req() req: any,
  ) {
    if (!emoji) {
      throw new BadRequestException('Emoji is required');
    }
    const result = await this.chatService.toggleMessageReaction(
      messageId,
      req.user.id,
      emoji,
    );
    this.chatGateway.broadcastMessageReaction(
      result.channelId,
      messageId,
      result.reactions,
    );
    return result;
  }

  // --- PROJECT ENDPOINTS ---

  @Get('projects')
  @ApiOperation({ summary: 'Get all projects in the workspace' })
  async getProjects(@Req() req: any) {
    return this.chatService.getProjects(req.user.id);
  }

  @Post('projects')
  @ApiOperation({ summary: 'Create a new project' })
  async createProject(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      description?: string;
      dueDate?: string;
      securityLevel?: string;
      invitedEmails?: string[];
    },
  ) {
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException('Project name is required');
    }
    return this.chatService.createProject(req.user.id, body);
  }

  @Patch('projects/:id')
  @ApiOperation({ summary: 'Update project details' })
  async updateProject(
    @Param('id') projectId: string,
    @Req() req: any,
    @Body()
    body: {
      name?: string;
      description?: string;
      dueDate?: string;
      securityLevel?: string;
      status?: 'active' | 'archived';
    },
  ) {
    return this.chatService.updateProject(projectId, req.user.id, body);
  }

  @Delete('projects/:id')
  @ApiOperation({ summary: 'Delete a project' })
  async deleteProject(@Param('id') projectId: string, @Req() req: any) {
    return this.chatService.deleteProject(projectId, req.user.id);
  }

  @Delete('projects/:projectId/members/:memberId')
  @ApiOperation({ summary: 'Remove a member from a project' })
  async removeProjectMember(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @Req() req: any,
  ) {
    const result = await this.chatService.removeProjectMember(
      projectId,
      memberId,
      req.user.id,
    );

    if (result.systemMessage && result.channelId) {
      const formattedMessage = {
        id: result.systemMessage.id,
        text: result.systemMessage.content,
        senderId: result.systemMessage.userId,
        senderName: result.systemMessage.user.name,
        senderAvatar: result.systemMessage.user.avatarUrl || undefined,
        timestamp: new Date(result.systemMessage.createdAt).toLocaleTimeString(
          [],
          { hour: '2-digit', minute: '2-digit' },
        ),
        createdAt: result.systemMessage.createdAt.toISOString(),
        isSelf: false,
        channelId: result.channelId,
        isSystem: true,
      };
      this.chatGateway.broadcastNewMessage(result.channelId, formattedMessage);
    }

    return { success: true };
  }

  @Patch('projects/:projectId/members/:memberId/roles')
  @ApiOperation({ summary: 'Update custom roles of a project member' })
  async updateProjectMemberRoles(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @Body('roles') roles: any[],
    @Req() req: any,
  ) {
    if (!Array.isArray(roles)) {
      throw new BadRequestException('Roles must be an array');
    }
    return this.chatService.updateProjectMemberRoles(
      projectId,
      memberId,
      roles,
      req.user.id,
    );
  }

  @Post('projects/:projectId/sprints')
  @ApiOperation({ summary: 'Create a sprint for a project' })
  async createSprint(
    @Param('projectId') projectId: string,
    @Body() body: { name: string; startDate?: string; endDate?: string },
    @Req() req: any,
  ) {
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException('Sprint name is required');
    }
    return this.chatService.createSprint(projectId, req.user.id, body);
  }

  @Patch('projects/:projectId/sprints/:sprintName')
  @ApiOperation({ summary: 'Update a sprint status' })
  async updateSprint(
    @Param('projectId') projectId: string,
    @Param('sprintName') sprintName: string,
    @Body() body: { status: string },
    @Req() req: any,
  ) {
    if (!body.status) {
      throw new BadRequestException('Sprint status is required');
    }
    return this.chatService.updateSprint(projectId, sprintName, body.status, req.user.id);
  }

  @Delete('projects/:projectId/sprints/:sprintName')
  @ApiOperation({ summary: 'Delete a sprint from a project' })
  async deleteSprint(
    @Param('projectId') projectId: string,
    @Param('sprintName') sprintName: string,
    @Req() req: any,
  ) {
    return this.chatService.deleteSprint(projectId, sprintName, req.user.id);
  }

  @Patch('messages/:messageId')
  @ApiOperation({ summary: 'Edit a message' })
  async editMessage(
    @Param('messageId') messageId: string,
    @Body('content') content: string,
    @Req() req: any,
  ) {
    if (!content || !content.trim()) {
      throw new BadRequestException('Content is required');
    }
    const updated = await this.chatService.editMessage(messageId, content.trim(), req.user.id);
    this.chatGateway.broadcastMessageEdit(updated.channelId, updated);
    return updated;
  }

  @Delete('messages/:messageId')
  @ApiOperation({ summary: 'Delete a message' })
  async deleteMessage(
    @Param('messageId') messageId: string,
    @Query('everyone') everyone: string,
    @Req() req: any,
  ) {
    const deleteForEveryone = everyone === 'true';
    const updated = await this.chatService.deleteMessage(messageId, req.user.id, deleteForEveryone);
    if ((updated as any).isDeleteForMeOnly) {
      this.chatGateway.broadcastMessageDeletionToUser(req.user.id, updated.channelId, messageId);
    } else {
      this.chatGateway.broadcastMessageDeletion(updated.channelId, messageId);
    }
    return { success: true };
  }

  @Delete('tasks/:taskId')
  @ApiOperation({ summary: 'Delete a task' })
  async deleteTask(@Param('taskId') taskId: string, @Req() req: any) {
    await this.chatService.deleteTask(taskId, req.user.id);
    return { success: true };
  }

  @Post('upload-voice')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: { type: 'string', format: 'binary' },
        channelId: { type: 'string' },
        duration: { type: 'number' },
      },
      required: ['audio', 'channelId'],
    },
  })
  @ApiOperation({ summary: 'Upload a voice note and create message' })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
      fileFilter: (req, file, cb) => {
        const cleanMime = file.mimetype.split(';')[0].trim();
        if (
          cleanMime === 'audio/webm' ||
          cleanMime === 'audio/mp4' ||
          cleanMime === 'audio/aac'
        ) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Only audio/webm, audio/mp4, and audio/aac are allowed. Received: ${file.mimetype}`,
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadVoice(
    @UploadedFile() file: any,
    @Body('channelId') channelId: string,
    @Body('duration') durationStr: string,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('No audio file provided');
    }
    if (!channelId) {
      throw new BadRequestException('Channel ID is required');
    }

    const duration = durationStr ? parseInt(durationStr, 10) : 0;

    const result = await this.chatService.uploadVoiceNote(
      file,
      channelId,
      duration,
      req.user.id,
    );

    // Broadcast the message via WebSockets to all connected clients in the room
    this.chatGateway.broadcastNewMessage(channelId, {
      ...result.message,
      isSelf: false, // Recipients see it as not self
      channelId,
      isSystem: false,
      createdAt: new Date().toISOString(),
    });

    return result;
  }

  @Post('conversations/:channelId/favorite')
  @ApiOperation({ summary: 'Toggle favorite state for a conversation' })
  async toggleFavorite(
    @Param('channelId') channelId: string,
    @Req() req: any,
  ) {
    return this.chatService.toggleFavorite(channelId, req.user.id);
  }
}
