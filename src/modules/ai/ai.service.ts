import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  getInitialQuestion() {
    return {
      message: "Hello. I'm ready to help you coordinate your upcoming sprints. How would you like to proceed with the Q4 initiatives?",
      nextQuestionIndex: 0
    };
  }

  private isProjectRelated(reply: string): boolean {
    const projectKeywords = /\b(project|projects)\b/i;
    return projectKeywords.test(reply);
  }

  async handleUserReply(index: number, reply: string, userId?: string) {
    if (!userId) {
      return {
        message: "You must be authenticated to talk to the AI assistant.",
        nextQuestionIndex: index,
      };
    }

    const osmApiKey = process.env.OSM_API_KEY;
    if (!osmApiKey) {
      console.warn("OSM_API_KEY is not defined in environment variables.");
      return {
        message: "AI assistant is not configured. Please contact the administrator.",
        nextQuestionIndex: index,
      };
    }

    const isProjectQuery = this.isProjectRelated(reply);
    let systemPrompt = `You are a helpful, friendly, and professional AI assistant for a collaborative workspace application called TeamCollab (Basecamp-like). Answer the user's questions directly, accurately, and politely.

If the user asks you to delete, modify, or create any projects, tasks, or members, you must not perform it. Instead, reply clearly: "You must delete manually." or "You must modify manually.".

CRITICAL: Do not use any special formatting characters (such as markdown bold asterisks **, bullet lists -, hashes #, backticks \`, or quotes) in your response. Return the response in plain text format only.`;

    if (isProjectQuery) {
      // Ensure default workspace or any workspace exists
      let workspace = await this.prisma.client.workspace.findFirst();
      if (!workspace) {
        workspace = await this.prisma.client.workspace.create({
          data: {
            name: 'Default Workspace',
            slug: 'default-workspace',
            createdBy: userId,
          },
        });
      }
      const workspaceId = workspace.id;

      // Fetch user's projects
      const projects = await this.prisma.client.project.findMany({
        where: {
          workspaceId,
          OR: [
            { createdBy: userId },
            {
              channel: {
                members: {
                  some: {
                    userId: userId,
                  },
                },
              },
            },
          ],
        },
        include: {
          tasks: {
            where: { deletedAt: null },
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
            },
          },
          creator: {
            select: {
              name: true,
              email: true,
            },
          },
          channel: {
            include: {
              members: {
                include: {
                  user: {
                    select: {
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Format projects context
      const projectsContext = projects
        .map((p) => {
          const tasksSummary = p.tasks
            .map((t) => `- [${t.status}] ${t.title} (Priority: ${t.priority})`)
            .join('\n');
          const membersSummary = p.channel?.members
            .map((m) => `- ${m.user.name} (${m.user.email}) [Role: ${m.role}]`)
            .join('\n') || '';

          return `Project Name: ${p.name}
Description: ${p.description || 'No description'}
Status: ${p.status}
Due Date: ${p.dueDate ? p.dueDate.toISOString() : 'No due date'}
Security Level: ${p.securityLevel}
Created By: ${p.creator?.name || 'Unknown'} (${p.creator?.email || ''})
Members Involved:
${membersSummary || 'No members listed'}
Tasks:
${tasksSummary || 'No tasks assigned'}`;
        })
        .join('\n\n---\n\n');

      systemPrompt = `You are an AI assistant helping a team member understand projects in their workspace.
Below is the context retrieved from the database's Project section. Use ONLY this information to answer the user's questions about projects. If there are no projects or the requested project is not found, state that clearly. Keep your answers extremely concise, accurate, and professional. Keep response short and relevant to target under 2-3 sentences.

If the user asks you to delete, modify, or create any projects, tasks, or members, you must not perform it. Instead, reply clearly: "You must delete manually." or "You must modify manually.".

CRITICAL: Do not use any special formatting characters (such as markdown bold asterisks **, bullet lists -, hashes #, backticks \`, or quotes) in your response. Return the response in plain text format only.

PROJECTS CONTEXT:
${projectsContext || 'No projects found in this workspace.'}`;
    }

    try {
      const response = await globalThis.fetch('https://api.osmapi.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${osmApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen3p6-plus',
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: reply,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`osmAPI error: ${response.status} - ${errText}`);
        return {
          message: "I encountered an error trying to connect to the AI model. Please try again later.",
          nextQuestionIndex: index,
        };
      }

      const data: any = await response.json();
      const aiResponseText = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
      return {
        message: aiResponseText,
        nextQuestionIndex: index,
      };
    } catch (error) {
      console.error("Failed to query osmAPI:", error);
      return {
        message: "An error occurred while analyzing your request. Please check your network connection and try again.",
        nextQuestionIndex: index,
      };
    }
  }
}
