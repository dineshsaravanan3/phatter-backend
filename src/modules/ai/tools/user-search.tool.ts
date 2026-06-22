import { ToolDefinition } from '../tool-registry.service';
import { ChatService } from '../../chat/chat.service';

export const UserSearchTool: ToolDefinition = {
  name: 'user_search',
  version: '1.0.0',
  category: 'READ',
  description: 'Search workspace users by name or email (paginated)',
  confirmationRequired: false,
  requiredPermissions: [],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name or email query to match (optional)' },
      limit: { type: 'integer', description: 'Number of results to return (default 20, max 100)' },
      page: { type: 'integer', description: 'Page number for pagination (default 1)' }
    }
  },
  execute: async (context, args, services) => {
    const chatService: ChatService = services.chatService;
    return chatService.searchWorkspaceUsers(
      context.userId,
      context.workspaceId,
      args.query,
      args.limit,
      args.page
    );
  }
};
