import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';
import { ToolRegistryService, ExecutionContext } from './tool-registry.service';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly chatService: ChatService,
  ) {}

  getInitialQuestion() {
    return {
      message: "Hello! I'm your TeamCollab AI Assistant. I can help you find projects, query tasks, create or close tasks, and schedule messages to your teammates. What would you like to do?",
      nextQuestionIndex: 0
    };
  }

  async getChatMessages(userId: string) {
    return this.prisma.client.aiChatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async clearChatHistory(userId: string) {
    await this.prisma.client.aiChatMessage.deleteMany({
      where: { userId },
    });
    return { success: true };
  }

  private async saveAiMessage(
    userId: string,
    text: string,
    requiresConfirmation: boolean,
    actionId?: string,
    tool?: string,
    toolArgs?: any,
    toolResults?: any
  ) {
    return this.prisma.client.aiChatMessage.create({
      data: {
        userId,
        text,
        sender: 'ai',
        requiresConfirmation,
        actionId: actionId || null,
        tool: tool || null,
        arguments: toolArgs || null,
        toolResults: toolResults || null,
        confirmationStatus: requiresConfirmation ? 'pending' : null
      }
    });
  }

  // Resolves ExecutionContext based on userId, including active workspace and RBAC permissions
  private async getExecutionContext(userId: string, timezone?: string): Promise<ExecutionContext> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('Authenticated user not found.');
    }

    // Determine current workspace context
    let workspace = await this.prisma.client.workspace.findFirst({
      where: {
        OR: [
          { createdBy: userId },
          {
            channels: {
              some: {
                members: {
                  some: { userId }
                }
              }
            }
          }
        ]
      }
    });

    if (!workspace) {
      // Find any workspace or seed default
      workspace = await this.prisma.client.workspace.findFirst();
      if (!workspace) {
        const defaultWorkspaceId = await this.chatService.ensureDefaultWorkspace(userId);
        workspace = await this.prisma.client.workspace.findUnique({
          where: { id: defaultWorkspaceId }
        });
      }
    }

    if (!workspace) {
      throw new NotFoundException('Could not resolve workspace context.');
    }

    // Role-based permissions mapping
    let permissions: string[] = [];
    if (user.role === 'admin') {
      permissions = ['PROJECT_CREATE', 'PROJECT_VIEW', 'TASK_CREATE', 'TASK_UPDATE', 'MESSAGE_SEND'];
    } else if (user.role === 'member') {
      permissions = ['PROJECT_VIEW', 'TASK_CREATE', 'TASK_UPDATE', 'MESSAGE_SEND'];
    } else {
      permissions = ['PROJECT_VIEW'];
    }

    return {
      userId,
      workspaceId: workspace.id,
      role: user.role,
      permissions,
      timezone: timezone || 'UTC'
    };
  }

  // Handles chat replies from the frontend, queries LLM, parses tools, and executes/creates confirmations
  async handleUserReply(index: number, reply: string, userId?: string, timezone?: string) {
    if (!userId) {
      return {
        message: "You must be authenticated to talk to the AI assistant.",
        nextQuestionIndex: index,
      };
    }

    // Save user message in database
    const userMessageRecord = await this.prisma.client.aiChatMessage.create({
      data: {
        userId,
        text: reply,
        sender: 'user',
      }
    });

    const osmApiKey = process.env.OSM_API_KEY;
    if (!osmApiKey) {
      console.warn("OSM_API_KEY is not defined in environment variables.");
      const errorMsg = "AI assistant is not configured. Please contact the administrator.";
      const aiMessageRecord = await this.saveAiMessage(userId, errorMsg, false);
      return {
        userMessage: userMessageRecord,
        aiMessage: aiMessageRecord,
        nextQuestionIndex: index,
      };
    }

    const modelName = process.env.AI_CHAT_MODEL || 'gpt-5.5';
    const context = await this.getExecutionContext(userId, timezone);

    // Formulate a dynamic prompt context informing the LLM about timezones and active date
    const systemPrompt = `You are a helpful, professional, and precise AI assistant for a collaborative workspace application called TeamCollab.
Today's date and time is: ${new Date().toISOString()}.
The user's local timezone is: ${context.timezone}.

You have access to tools that can read and write workspace information. Always resolve relative times (e.g. "tomorrow at 3 PM") based on the current time and timezone context, converting to full UTC ISO timestamps before calling schedule/creation tools.

If you decide to invoke a tool, output the function call correctly. Always prefer calling tools when the user's intent matches them.
If the tool returns error details, present them to the user concisely.`;

    const toolsSpec = this.toolRegistry.getLLMToolsSpec();

    try {
      const messagesPayload: any[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: reply }
      ];

      const response = await globalThis.fetch('https://api.osmapi.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${osmApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          messages: messagesPayload,
          tools: toolsSpec,
          tool_choice: 'auto'
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`osmAPI error: ${response.status} - ${errText}`);
        const errorMsg = "I encountered an error trying to connect to the AI model. Please try again later.";
        const aiMessageRecord = await this.saveAiMessage(userId, errorMsg, false);
        return {
          userMessage: userMessageRecord,
          aiMessage: aiMessageRecord,
          nextQuestionIndex: index,
        };
      }

      const data: any = await response.json();
      const choice = data.choices?.[0];
      if (!choice) {
        const errorMsg = "Sorry, I could not generate a response.";
        const aiMessageRecord = await this.saveAiMessage(userId, errorMsg, false);
        return {
          userMessage: userMessageRecord,
          aiMessage: aiMessageRecord,
          nextQuestionIndex: index,
        };
      }

      const aiMessage = choice.message;

      // Handle LLM Tool Calling
      if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
        const toolCall = aiMessage.tool_calls[0]; // Process first tool call
        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};

        const tool = this.toolRegistry.getTool(toolName);
        if (!tool) {
          const errorMsg = `I wanted to use a tool called "${toolName}" but it is not available.`;
          const aiMessageRecord = await this.saveAiMessage(userId, errorMsg, false);
          return {
            userMessage: userMessageRecord,
            aiMessage: aiMessageRecord,
            nextQuestionIndex: index,
          };
        }

        // WRITE Tool -> Requires Confirmation Flow
        if (tool.category === 'WRITE' || tool.confirmationRequired) {
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
          const pendingAction = await this.prisma.client.aiPendingAction.create({
            data: {
              userId,
              workspaceId: context.workspaceId,
              toolName: tool.name,
              arguments: toolArgs,
              status: 'pending',
              expiresAt,
            }
          });

          const confirmationMsg = `I've prepared a confirmation for you to perform this action. Please confirm below.`;
          const aiMessageRecord = await this.saveAiMessage(
            userId,
            confirmationMsg,
            true,
            pendingAction.id,
            tool.name,
            toolArgs
          );

          return {
            userMessage: userMessageRecord,
            aiMessage: aiMessageRecord,
            nextQuestionIndex: index,
          };
        }

        // READ Tool -> Execute Immediately
        const startTime = Date.now();
        try {
          const result = await this.toolRegistry.executeTool(tool.name, context, toolArgs);
          const executionTimeMs = Date.now() - startTime;

          // Write audit log
          await this.prisma.client.aiAuditLog.create({
            data: {
              userId,
              toolName: tool.name,
              toolVersion: tool.version,
              arguments: toolArgs,
              result: result as any,
              success: true,
              executionTimeMs
            }
          });

          // Second turn: Send tool results back to LLM to formulate friendly summary response
          messagesPayload.push(aiMessage);
          messagesPayload.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: tool.name,
            content: JSON.stringify(result)
          });

          const secondResponse = await globalThis.fetch('https://api.osmapi.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${osmApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelName,
              messages: messagesPayload
            })
          });

          let summaryMessage = "Here is the information I retrieved.";
          if (secondResponse.ok) {
            const secondData: any = await secondResponse.json();
            summaryMessage = secondData.choices?.[0]?.message?.content || summaryMessage;
          }

          const aiMessageRecord = await this.saveAiMessage(
            userId,
            summaryMessage,
            false,
            undefined,
            tool.name,
            toolArgs,
            [{ type: tool.name, status: 'success', data: result }]
          );

          return {
            userMessage: userMessageRecord,
            aiMessage: aiMessageRecord,
            nextQuestionIndex: index
          };

        } catch (error: any) {
          const executionTimeMs = Date.now() - startTime;
          await this.prisma.client.aiAuditLog.create({
            data: {
              userId,
              toolName: tool.name,
              toolVersion: tool.version,
              arguments: toolArgs,
              result: { error: error.message },
              success: false,
              executionTimeMs
            }
          });

          const errorMsg = `I encountered an error trying to search: ${error.message}`;
          const aiMessageRecord = await this.saveAiMessage(userId, errorMsg, false);
          return {
            userMessage: userMessageRecord,
            aiMessage: aiMessageRecord,
            nextQuestionIndex: index
          };
        }
      }

      // Simple Text Response
      const content = aiMessage.content || 'Sorry, I could not generate a response.';
      const aiMessageRecord = await this.saveAiMessage(userId, content, false);
      return {
        userMessage: userMessageRecord,
        aiMessage: aiMessageRecord,
        nextQuestionIndex: index,
      };

    } catch (error) {
      console.error("Failed to query osmAPI:", error);
      const errorMsg = "An error occurred while analyzing your request. Please check your network connection and try again.";
      const aiMessageRecord = await this.saveAiMessage(userId, errorMsg, false);
      return {
        userMessage: userMessageRecord,
        aiMessage: aiMessageRecord,
        nextQuestionIndex: index,
      };
    }
  }

  // Executes a previously confirmed WRITE action using the locked action details
  async executeConfirmedTool(userId: string, actionId: string) {
    // Transactional load & lock verification
    const action = await this.prisma.client.aiPendingAction.findUnique({
      where: { id: actionId }
    });

    if (!action) {
      throw new NotFoundException('Confirmation request not found.');
    }

    if (action.status !== 'pending') {
      throw new BadRequestException(`This action has already been processed (Status: ${action.status}).`);
    }

    if (action.expiresAt < new Date()) {
      await this.prisma.client.aiPendingAction.update({
        where: { id: actionId },
        data: { status: 'expired' }
      });
      await this.prisma.client.aiChatMessage.updateMany({
        where: { actionId },
        data: {
          requiresConfirmation: false,
          confirmationStatus: 'expired'
        }
      });
      throw new BadRequestException('This confirmation request has expired.');
    }

    const tool = this.toolRegistry.getTool(action.toolName);
    if (!tool) {
      throw new NotFoundException(`The tool "${action.toolName}" is no longer available.`);
    }

    // Reconstruct secure ExecutionContext using stored action metadata
    const context = await this.getExecutionContext(action.userId);
    // Explicitly enforce the workspace context saved when confirmation was created
    context.workspaceId = action.workspaceId;

    const startTime = Date.now();
    try {
      // Execute the tool logic
      const result = await this.toolRegistry.executeTool(tool.name, context, action.arguments);
      const executionTimeMs = Date.now() - startTime;

      // Update action status to completed
      await this.prisma.client.aiPendingAction.update({
        where: { id: actionId },
        data: { status: 'completed' }
      });

      // Update the AiChatMessage status and results
      await this.prisma.client.aiChatMessage.updateMany({
        where: { actionId },
        data: {
          requiresConfirmation: false,
          confirmationStatus: 'confirmed',
          toolResults: [{ type: tool.name, status: 'success', data: result }] as any
        }
      });

      // Write execution audit logs
      await this.prisma.client.aiAuditLog.create({
        data: {
          userId,
          toolName: tool.name,
          toolVersion: tool.version,
          arguments: action.arguments as any,
          result: result as any,
          success: true,
          executionTimeMs
        }
      });

      return {
        success: true,
        tool: tool.name,
        result
      };

    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;

      // Update status to failed
      await this.prisma.client.aiPendingAction.update({
        where: { id: actionId },
        data: { status: 'failed' }
      });

      // Update the AiChatMessage confirmation status
      await this.prisma.client.aiChatMessage.updateMany({
        where: { actionId },
        data: {
          confirmationStatus: 'failed'
        }
      });

      // Write failure audit logs
      await this.prisma.client.aiAuditLog.create({
        data: {
          userId,
          toolName: tool.name,
          toolVersion: tool.version,
          arguments: action.arguments as any,
          result: { error: error.message },
          success: false,
          executionTimeMs
        }
      });

      throw new BadRequestException(error.message || 'Failed to execute the confirmed action.');
    }
  }

  // Updates the confirmation action state to cancelled
  async cancelAction(userId: string, actionId: string) {
    const action = await this.prisma.client.aiPendingAction.findUnique({
      where: { id: actionId }
    });

    if (!action) {
      throw new NotFoundException('Confirmation request not found.');
    }

    if (action.userId !== userId) {
      throw new ForbiddenException('You are not authorized to cancel this action.');
    }

    if (action.status !== 'pending') {
      throw new BadRequestException(`Cannot cancel action in state: ${action.status}`);
    }

    await this.prisma.client.aiPendingAction.update({
      where: { id: actionId },
      data: { status: 'cancelled' }
    });

    await this.prisma.client.aiChatMessage.updateMany({
      where: { actionId },
      data: {
        requiresConfirmation: false,
        confirmationStatus: 'cancelled'
      }
    });

    return { success: true };
  }

  // Periodic cleaner to transition expired confirmations
  async cleanupExpiredActions() {
    const now = new Date();
    await this.prisma.client.aiPendingAction.updateMany({
      where: {
        status: 'pending',
        expiresAt: { lt: now }
      },
      data: {
        status: 'expired'
      }
    });
  }
}
