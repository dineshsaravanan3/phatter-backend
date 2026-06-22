import { ToolDefinition } from '../tool-registry.service';
import { ChatService } from '../../chat/chat.service';

export const ProjectSearchTool: ToolDefinition = {
  name: 'project_search',
  version: '1.0.0',
  category: 'READ',
  description: 'Search projects in the current workspace by name (paginated)',
  confirmationRequired: false,
  requiredPermissions: [],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term to match project names (optional)' },
      limit: { type: 'integer', description: 'Number of results to return (default 20, max 100)' },
      page: { type: 'integer', description: 'Page number for pagination (default 1)' }
    }
  },
  execute: async (context, args, services) => {
    const chatService: ChatService = services.chatService;
    return chatService.searchProjects(
      context.userId,
      context.workspaceId,
      args.query,
      args.limit,
      args.page
    );
  }
};
