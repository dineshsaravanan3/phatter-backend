import { ToolDefinition } from '../tool-registry.service';
import { ChatService } from '../../chat/chat.service';

export const TaskSearchTool: ToolDefinition = {
  name: 'task_search',
  version: '1.0.0',
  category: 'READ',
  description: 'Search tasks within the current workspace, optionally filtered by project (paginated)',
  confirmationRequired: false,
  requiredPermissions: [],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term for task titles (optional)' },
      projectId: { type: 'string', description: 'Filter tasks by project ID (optional)' },
      limit: { type: 'integer', description: 'Number of results to return (default 20, max 100)' },
      page: { type: 'integer', description: 'Page number for pagination (default 1)' }
    }
  },
  execute: async (context, args, services) => {
    const chatService: ChatService = services.chatService;
    return chatService.searchTasks(
      context.userId,
      context.workspaceId,
      args.query,
      args.projectId,
      args.limit,
      args.page
    );
  }
};
