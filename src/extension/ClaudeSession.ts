import * as vscode from 'vscode';
import type { PermissionHandler } from './PermissionHandler';
import type {
  ExtensionToWebviewMessage,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
} from '../shared/types';

// Dynamic import for the SDK (ESM module)
let queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query | undefined;

async function loadSDK() {
  if (!queryFn) {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    queryFn = sdk.query;
  }
  return queryFn;
}

export interface SessionOptions {
  cwd: string;
  permissionHandler: PermissionHandler;
  onMessage: (message: ExtensionToWebviewMessage) => void;
  onSessionIdChange?: (sessionId: string | null) => void;
}

export class ClaudeSession {
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;
  private isProcessing = false;
  private resumeSessionId: string | null = null;

  constructor(private options: SessionOptions) {}

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  get processing(): boolean {
    return this.isProcessing;
  }

  setResumeSession(sessionId: string | null): void {
    this.resumeSessionId = sessionId;
    this.sessionId = sessionId;
  }

  async sendMessage(prompt: string, agentId?: string): Promise<void> {
    if (this.isProcessing) {
      this.options.onMessage({
        type: 'error',
        message: 'A request is already in progress',
      });
      return;
    }

    const query = await loadSDK();
    if (!query) {
      this.options.onMessage({
        type: 'error',
        message: 'Failed to load Claude Agent SDK',
      });
      return;
    }

    this.isProcessing = true;
    this.abortController = new AbortController();
    this.options.onMessage({ type: 'processing', isProcessing: true });

    try {
      const config = vscode.workspace.getConfiguration('claude-unbound');
      const maxTurns = config.get<number>('maxTurns', 50);

      // Build query options
      const queryOptions: Parameters<typeof query>[0]['options'] = {
        cwd: this.options.cwd,
        abortController: this.abortController,
        includePartialMessages: true,
        maxTurns,
        canUseTool: async (toolName, input, context) => {
          const result = await this.options.permissionHandler.canUseTool(toolName, input, context);
          if (result.behavior === 'allow') {
            return {
              behavior: 'allow' as const,
              updatedInput: (result.updatedInput ?? input) as Record<string, unknown>,
            };
          }
          return {
            behavior: 'deny' as const,
            message: result.message ?? 'Permission denied',
          };
        },
        settingSources: ['project'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        tools: { type: 'preset', preset: 'claude_code' },
        hooks: {
          PreToolUse: [{
            hooks: [
              async (params: unknown): Promise<Record<string, unknown>> => {
                // Notify webview that a tool is about to be used
                const p = params as { tool_name?: string; tool_input?: unknown };
                if (p.tool_name) {
                  this.options.onMessage({
                    type: 'toolPending',
                    toolName: p.tool_name,
                    input: p.tool_input,
                  });
                }
                return {}; // Continue with tool execution
              },
            ],
          }],
          Notification: [{
            hooks: [
              async (params: unknown): Promise<Record<string, unknown>> => {
                // Forward notifications to webview
                const p = params as { message?: string; type?: string };
                if (p.message) {
                  this.options.onMessage({
                    type: 'notification',
                    message: p.message,
                    notificationType: p.type || 'info',
                  } as ExtensionToWebviewMessage);
                }
                return {};
              },
            ],
          }],
        },
      };

      // Add resume option if we have a session to resume
      if (this.resumeSessionId) {
        (queryOptions as Record<string, unknown>).resume = this.resumeSessionId;
        this.resumeSessionId = null; // Clear after use
      }

      // Configure agent-specific system prompt suffix (appends to preset, doesn't replace)
      if (agentId && agentId !== 'default') {
        const agentSuffixes: Record<string, string> = {
          'code-reviewer': '\n\nYou are acting as an expert code reviewer. Focus on code quality, potential bugs, security issues, and best practices. Provide constructive feedback with specific suggestions.',
          'explorer': '\n\nYou are a fast codebase explorer. Focus on quickly finding files, understanding project structure, and answering questions about how code is organized. Prefer using Glob and Grep tools for efficiency.',
          'planner': '\n\nYou are a software architect. Focus on designing implementation plans, identifying critical files, considering architectural trade-offs, and breaking down tasks into clear steps.',
        };

        const suffix = agentSuffixes[agentId];
        if (suffix) {
          // Use systemPromptSuffix to append to the preset instead of replacing it
          (queryOptions as Record<string, unknown>).systemPromptSuffix = suffix;
        }
      }

      const result = query({
        prompt,
        options: queryOptions,
      });

      for await (const message of result) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        switch (message.type) {
          case 'assistant':
            if (this.sessionId !== message.session_id) {
              this.sessionId = message.session_id;
              this.options.onSessionIdChange?.(this.sessionId);
            }
            this.options.onMessage({
              type: 'assistant',
              data: {
                type: 'assistant',
                message: {
                  id: message.message.id,
                  role: 'assistant',
                  content: this.serializeContent(message.message.content),
                  model: message.message.model,
                  stop_reason: message.message.stop_reason,
                },
                session_id: message.session_id,
              },
            });
            break;

          case 'stream_event':
            if (message.event.type === 'content_block_delta') {
              this.options.onMessage({
                type: 'partial',
                data: {
                  type: 'partial',
                  content: [],
                  session_id: this.sessionId || '',
                },
              });
            }
            break;

          case 'result':
            this.options.onMessage({
              type: 'done',
              data: {
                type: 'result',
                session_id: message.session_id,
                is_done: !message.is_error,
                total_cost_usd: message.total_cost_usd,
                total_input_tokens: message.usage?.input_tokens,
                total_output_tokens: message.usage?.output_tokens,
                num_turns: message.num_turns,
              },
            });
            break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.options.onMessage({
        type: 'error',
        message: errorMessage,
      });
    } finally {
      this.isProcessing = false;
      this.abortController = null;
      this.options.onMessage({ type: 'processing', isProcessing: false });
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isProcessing = false;
  }

  reset(): void {
    this.cancel();
    this.sessionId = null;
  }

  private serializeContent(content: unknown[]): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    for (const block of content) {
      const b = block as { type: string; [key: string]: unknown };
      if (b.type === 'text' && typeof b.text === 'string') {
        blocks.push({ type: 'text', text: b.text } satisfies TextBlock);
      } else if (b.type === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          id: b.id as string,
          name: b.name as string,
          input: (b.input as Record<string, unknown>) || {},
        } satisfies ToolUseBlock);
      }
    }

    return blocks;
  }
}
