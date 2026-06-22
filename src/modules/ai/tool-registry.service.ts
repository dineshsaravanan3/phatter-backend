import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';
import { ChatGateway } from '../chat/chat.gateway';
import { allTools } from './tools';

export interface ExecutionContext {
  userId: string;
  workspaceId: string;
  role: string;
  permissions: string[];
  channelId?: string;
  timezone?: string;
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  version: string;
  category: 'READ' | 'WRITE';
  description: string;
  inputSchema: Record<string, any>;
  requiredPermissions: string[];
  confirmationRequired: boolean;
  execute: (context: ExecutionContext, args: TInput, services: any) => Promise<TOutput>;
}

@Injectable()
export class ToolRegistryService {
  private tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {
    this.registerAllTools();
  }

  // Register all modular tool definitions
  private registerAllTools() {
    for (const tool of allTools) {
      this.tools.set(tool.name, tool);
    }
  }

  // Retrieve a registered tool definition
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  // Retrieve all registered tools
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  // Formats all registered tools to OpenAI-compatible function specification JSON
  getLLMToolsSpec() {
    return this.getAllTools().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  // Runs a registered tool by its name after enforcing security permissions
  async executeTool(name: string, context: ExecutionContext, args: any): Promise<any> {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found in registry.`);
    }

    // Security check: Verify that user has all the required permissions
    if (tool.requiredPermissions && tool.requiredPermissions.length > 0) {
      const userPermissions = context.permissions || [];
      const hasAll = tool.requiredPermissions.every(p => userPermissions.includes(p));
      if (!hasAll) {
        throw new ForbiddenException(
          `User does not have required permissions: ${tool.requiredPermissions.join(', ')}`
        );
      }
    }

    const services = {
      prisma: this.prisma,
      chatService: this.chatService,
      chatGateway: this.chatGateway,
    };

    return tool.execute(context, args, services);
  }
}
