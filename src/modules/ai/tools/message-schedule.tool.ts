import { ToolDefinition } from '../tool-registry.service';
import { ChatService } from '../../chat/chat.service';

export const MessageScheduleTool: ToolDefinition = {
  name: 'message_schedule',
  version: '1.0.0',
  category: 'WRITE',
  description: 'Schedule a message to be sent to a user or group channel at a specific time',
  confirmationRequired: true,
  requiredPermissions: ['MESSAGE_SEND'],
  inputSchema: {
    type: 'object',
    properties: {
      targetName: { type: 'string', description: 'Name or email of the recipient user, or the group channel name' },
      isGroup: { type: 'boolean', description: 'True if targetName refers to a channel, false if it refers to a user (DM)' },
      content: { type: 'string', description: 'Content of the message to send' },
      scheduledTime: { type: 'string', format: 'date-time', description: 'Target date-time ISO string representing when to deliver the message' }
    },
    required: ['targetName', 'isGroup', 'content', 'scheduledTime']
  },
  execute: async (context, args, services) => {
    const chatService: ChatService = services.chatService;
    return chatService.scheduleMessage(
      context.userId,
      context.workspaceId,
      args.targetName,
      args.isGroup,
      args.content,
      args.scheduledTime
    );
  }
};
