import { ToolDefinition } from '../tool-registry.service';
import { ChatService } from '../../chat/chat.service';

export const ProjectGetTool: ToolDefinition = {
  name: 'project_get',
  version: '1.0.0',
  category: 'READ',
  description: 'Retrieve detailed information for a single project by name or ID, including its tasks and members',
  confirmationRequired: false,
  requiredPermissions: [],
  inputSchema: {
    type: 'object',
    properties: {
      idOrName: { type: 'string', description: 'The exact ID or name of the project to retrieve' }
    },
    required: ['idOrName']
  },
  execute: async (context, args, services) => {
    const chatService: ChatService = services.chatService;
    return chatService.getProjectByIdOrName(
      context.userId,
      context.workspaceId,
      args.idOrName
    );
  }
};
