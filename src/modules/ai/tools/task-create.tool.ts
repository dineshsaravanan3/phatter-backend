import { ToolDefinition } from '../tool-registry.service';
import { ChatService } from '../../chat/chat.service';

export const TaskCreateTool: ToolDefinition = {
  name: 'task_create',
  version: '1.0.0',
  category: 'WRITE',
  description: 'Create a new task in a project',
  confirmationRequired: true,
  requiredPermissions: ['TASK_CREATE'],
  inputSchema: {
    type: 'object',
    properties: {
      projectName: { type: 'string', description: 'Name of the project to create this task in' },
      title: { type: 'string', description: 'Title of the task' },
      description: { type: 'string', description: 'Description of the task (optional)' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Priority level (default: medium)' },
      dueDate: { type: 'string', format: 'date-time', description: 'ISO date string for task due date (optional)' }
    },
    required: ['projectName', 'title']
  },
  execute: async (context, args, services) => {
    const chatService: ChatService = services.chatService;
    return chatService.createTaskInProject(
      context.userId,
      context.workspaceId,
      args.projectName,
      args.title,
      args.description,
      args.priority,
      args.dueDate
    );
  }
};
