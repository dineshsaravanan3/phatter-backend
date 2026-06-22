import { ToolDefinition } from '../tool-registry.service';
import { ChatService } from '../../chat/chat.service';

export const TaskCloseTool: ToolDefinition = {
  name: 'task_close',
  version: '1.0.0',
  category: 'WRITE',
  description: 'Mark a task as done (completed)',
  confirmationRequired: true,
  requiredPermissions: ['TASK_UPDATE'],
  inputSchema: {
    type: 'object',
    properties: {
      taskTitle: { type: 'string', description: 'Title of the task to close' },
      projectName: { type: 'string', description: 'Name of the project to search for the task (optional)' }
    },
    required: ['taskTitle']
  },
  execute: async (context, args, services) => {
    const chatService: ChatService = services.chatService;
    return chatService.closeTaskByName(
      context.userId,
      context.workspaceId,
      args.taskTitle,
      args.projectName
    );
  }
};
