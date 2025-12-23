import * as vscode from 'vscode';
import { log } from './logger';
import type { PermissionHandler } from './PermissionHandler';
import type {
  ExtensionToWebviewMessage,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ThinkingBlock,
  AccountInfo,
  ModelInfo,
  SlashCommandInfo,
  McpServerStatusInfo,
  McpServerConfig,
  SandboxConfig,
  SystemInitData,
  AgentDefinition,
  PermissionMode,
} from '../shared/types';

// Type for the Query object returned by the SDK
type Query = ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;

// Dynamic import for the SDK (ESM module)
let queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query | undefined;

async function loadSDK() {
  if (!queryFn) {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    queryFn = sdk.query;
  }
  return queryFn;
}

// Agent definitions using proper SDK agents option
const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  'code-reviewer': {
    description: 'Expert code review and analysis',
    prompt: 'You are an expert code reviewer. Focus on code quality, potential bugs, security issues, and best practices. Provide constructive feedback with specific suggestions. Do NOT modify files unless explicitly asked.',
    tools: ['Read', 'Glob', 'Grep', 'LSP'],
    model: 'inherit',
  },
  'explorer': {
    description: 'Fast codebase exploration',
    prompt: 'You are a fast codebase explorer. Focus on quickly finding files, understanding project structure, and answering questions about how code is organized. Prefer using Glob and Grep tools for efficiency.',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'LSP'],
    model: 'haiku',
  },
  'planner': {
    description: 'Software architecture planning',
    prompt: 'You are a software architect. Focus on designing implementation plans, identifying critical files, considering architectural trade-offs, and breaking down tasks into clear steps. Do NOT modify files - only analyze and plan.',
    tools: ['Read', 'Glob', 'Grep', 'LSP'],
    model: 'opus',
  },
};

export interface SessionOptions {
  cwd: string;
  permissionHandler: PermissionHandler;
  onMessage: (message: ExtensionToWebviewMessage) => void;
  onSessionIdChange?: (sessionId: string | null) => void;
  mcpServers?: Record<string, McpServerConfig>;
}

interface PendingAssistantMessage {
  id: string;
  model: string;
  stopReason: string | null;
  content: ContentBlock[];
  sessionId: string;
}

interface StreamingContent {
  messageId: string | null;  // Which message this content belongs to
  thinking: string;
  text: string;
  isThinking: boolean;
  hasStreamedTools: boolean;  // Once true, stop sending partial updates (thinking is "frozen")
}

// Tracks a tool that was streamed to UI but may or may not execute
interface StreamedToolInfo {
  toolName: string;
  messageId: string;
}

export class ClaudeSession {
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;
  private isProcessing = false;
  private resumeSessionId: string | null = null;
  private currentQuery: Query | null = null;
  private cachedModels: ModelInfo[] | null = null;
  private lastUserMessageId: string | null = null;
  private messageCheckpoints: Map<string, string> = new Map();
  private accumulatedCost = 0;
  private pendingAssistant: PendingAssistantMessage | null = null;
  private streamingContent: StreamingContent = { messageId: null, thinking: '', text: '', isThinking: false, hasStreamedTools: false };
  // Tracks tools that were streamed to UI - if they never reach PreToolUse/completion, they're "abandoned"
  private streamedToolIds: Map<string, StreamedToolInfo> = new Map();

  constructor(private options: SessionOptions) {}

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  get processing(): boolean {
    return this.isProcessing;
  }

  private flushPendingAssistant(): void {
    if (!this.pendingAssistant) return;

    const pending = this.pendingAssistant;
    this.pendingAssistant = null;

    // Track checkpoint for this assistant message
    if (this.lastUserMessageId) {
      this.messageCheckpoints.set(pending.id, this.lastUserMessageId);
    }

    // Send toolAbandoned for any tools that were streamed but never executed
    // This happens when Claude streams a tool_use block but then changes course
    for (const [toolUseId, info] of this.streamedToolIds.entries()) {
      // Only abandon tools from THIS message (not tools from future messages)
      if (info.messageId === pending.id) {
        log('[ClaudeSession] Tool was streamed but never executed, sending toolAbandoned:', info.toolName, toolUseId);
        this.options.onMessage({
          type: 'toolAbandoned',
          toolUseId,
          toolName: info.toolName,
        });
        this.streamedToolIds.delete(toolUseId);
      }
    }

    log('[ClaudeSession] Flushing consolidated assistant message:', pending.content);

    this.options.onMessage({
      type: 'assistant',
      data: {
        type: 'assistant',
        message: {
          id: pending.id,
          role: 'assistant',
          content: pending.content,
          model: pending.model,
          stop_reason: pending.stopReason,
        },
        session_id: pending.sessionId,
      },
    });
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
    this.pendingAssistant = null;
    this.streamingContent = { messageId: null, thinking: '', text: '', isThinking: false, hasStreamedTools: false };
    this.options.onMessage({ type: 'processing', isProcessing: true });

    try {
      const config = vscode.workspace.getConfiguration('claude-unbound');
      const maxTurns = config.get<number>('maxTurns', 50);
      // Default to Opus 4.5 if no model is specified
      const configuredModel = config.get<string>('model', '');
      const model = configuredModel || 'claude-opus-4-5-20251101';
      const maxBudgetUsd = config.get<number | null>('maxBudgetUsd', null);
      const maxThinkingTokens = config.get<number | null>('maxThinkingTokens', null);
      const betasEnabledRaw = config.get<string[]>('betasEnabled', []);
      // Filter to only include valid beta values that the SDK accepts
      const betasEnabled = betasEnabledRaw.filter(
        (b): b is 'context-1m-2025-08-07' => b === 'context-1m-2025-08-07'
      );
      const enableFileCheckpointing = config.get<boolean>('enableFileCheckpointing', true);
      const sandboxConfig = config.get<SandboxConfig>('sandbox', { enabled: false });

      // Build query options with all SDK features
      const queryOptions: Parameters<typeof query>[0]['options'] = {
        cwd: this.options.cwd,
        abortController: this.abortController,
        includePartialMessages: true,
        maxTurns,
        // Model selection (defaults to Opus 4.5)
        model,
        // New: Budget limit
        ...(maxBudgetUsd && { maxBudgetUsd }),
        // New: Extended thinking
        ...(maxThinkingTokens && { maxThinkingTokens }),
        // New: Beta features (e.g., 1M context window)
        ...(betasEnabled.length > 0 && { betas: betasEnabled }),
        // New: File checkpointing for rewind
        enableFileCheckpointing,
        // New: Sandbox configuration
        ...(sandboxConfig?.enabled && {
          sandbox: {
            enabled: true,
            autoAllowBashIfSandboxed: sandboxConfig.autoAllowBashIfSandboxed,
            allowUnsandboxedCommands: sandboxConfig.allowUnsandboxedCommands,
            ...(sandboxConfig.networkAllowedDomains?.length && {
              network: {
                allowLocalBinding: sandboxConfig.networkAllowLocalBinding,
              },
            }),
          },
        }),
        // New: MCP servers (loaded from .mcp.json)
        ...(this.options.mcpServers && Object.keys(this.options.mcpServers).length > 0 && {
          mcpServers: this.options.mcpServers,
        }),
        // New: Proper agent definitions (replacing systemPromptSuffix)
        agents: AGENT_DEFINITIONS,
        canUseTool: async (toolName, input, context) => {
          // Flush any accumulated text/thinking content so it appears in the UI
          // before the tool call. The tool call itself is sent via requestPermission.
          this.flushPendingAssistant();

          const ctx = context as { tool_use_id?: string } | undefined;
          const toolUseId = ctx?.tool_use_id;

          const result = await this.options.permissionHandler.canUseTool(toolName, input, context);
          if (result.behavior === 'allow') {
            // Tool will execute - remove from orphan tracking
            if (toolUseId) {
              this.streamedToolIds.delete(toolUseId);
            }
            return {
              behavior: 'allow' as const,
              updatedInput: (result.updatedInput ?? input) as Record<string, unknown>,
            };
          }
          // Tool was denied - send toolFailed since PostToolUseFailure won't fire
          // (that hook only fires for execution failures, not permission denials)
          if (toolUseId) {
            // Remove from orphan tracking - we're handling it now
            this.streamedToolIds.delete(toolUseId);
            log('[ClaudeSession] Tool denied, sending toolFailed:', toolName, toolUseId);
            this.options.onMessage({
              type: 'toolFailed',
              toolUseId,
              toolName,
              error: result.message ?? 'Permission denied',
              isInterrupt: false,
            });
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
          // === PreToolUse: Tool is about to execute - mark as running ===
          PreToolUse: [{
            hooks: [
              async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
                const p = params as { tool_name?: string; tool_input?: unknown };
                log('[ClaudeSession] PreToolUse hook fired:', p.tool_name, 'toolUseId:', toolUseId);
                if (p.tool_name && toolUseId) {
                  // Remove from orphan tracking - this tool IS executing
                  this.streamedToolIds.delete(toolUseId);
                  // Notify UI that tool is now running (not just pending)
                  this.options.onMessage({
                    type: 'toolPending',  // TODO: Consider adding 'toolRunning' message type
                    toolName: p.tool_name,
                    input: p.tool_input,
                  });
                }
                return {};
              },
            ],
          }],
          // === PostToolUse: Track tool completion ===
          PostToolUse: [{
            hooks: [
              async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
                log('[ClaudeSession] PostToolUse hook fired:', params, 'toolUseId:', toolUseId);
                const p = params as { tool_name?: string; tool_use_id?: string; tool_response?: unknown };
                const id = toolUseId ?? p.tool_use_id;
                if (p.tool_name && id) {
                  // Remove from orphan tracking (just in case PreToolUse didn't fire)
                  this.streamedToolIds.delete(id);
                  log('[ClaudeSession] Sending toolCompleted:', p.tool_name, id);
                  this.options.onMessage({
                    type: 'toolCompleted',
                    toolUseId: id,
                    toolName: p.tool_name,
                    result: this.serializeToolResult(p.tool_response),
                  });
                }
                return {};
              },
            ],
          }],
          // === PostToolUseFailure: Handle tool failures ===
          PostToolUseFailure: [{
            hooks: [
              async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
                log('[ClaudeSession] PostToolUseFailure hook fired:', params, 'toolUseId:', toolUseId);
                const p = params as { tool_name?: string; tool_use_id?: string; error?: string; is_interrupt?: boolean };
                const id = toolUseId ?? p.tool_use_id;
                if (p.tool_name && id) {
                  // Remove from orphan tracking
                  this.streamedToolIds.delete(id);
                  log('[ClaudeSession] Sending toolFailed:', p.tool_name, id);
                  this.options.onMessage({
                    type: 'toolFailed',
                    toolUseId: id,
                    toolName: p.tool_name,
                    error: p.error || 'Unknown error',
                    isInterrupt: p.is_interrupt,
                  });
                }
                return {};
              },
            ],
          }],
          // === Notification: Forward to webview ===
          Notification: [{
            hooks: [
              async (params: unknown): Promise<Record<string, unknown>> => {
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
          // === SessionStart: Track session lifecycle ===
          SessionStart: [{
            hooks: [
              async (params: unknown): Promise<Record<string, unknown>> => {
                const p = params as { source?: 'startup' | 'resume' | 'clear' | 'compact' };
                this.options.onMessage({
                  type: 'sessionStart',
                  source: p.source || 'startup',
                });
                return {};
              },
            ],
          }],
          // === SessionEnd: Track session end ===
          SessionEnd: [{
            hooks: [
              async (params: unknown): Promise<Record<string, unknown>> => {
                const p = params as { reason?: string };
                this.options.onMessage({
                  type: 'sessionEnd',
                  reason: p.reason || 'completed',
                });
                return {};
              },
            ],
          }],
          // === SubagentStart: Track subagent spawning ===
          SubagentStart: [{
            hooks: [
              async (params: unknown): Promise<Record<string, unknown>> => {
                const p = params as { agent_id?: string; agent_type?: string };
                if (p.agent_id) {
                  this.options.onMessage({
                    type: 'subagentStart',
                    agentId: p.agent_id,
                    agentType: p.agent_type || 'unknown',
                  });
                }
                return {};
              },
            ],
          }],
          // === SubagentStop: Track subagent completion ===
          SubagentStop: [{
            hooks: [
              async (params: unknown): Promise<Record<string, unknown>> => {
                const p = params as { agent_id?: string };
                if (p.agent_id) {
                  this.options.onMessage({
                    type: 'subagentStop',
                    agentId: p.agent_id,
                  });
                }
                return {};
              },
            ],
          }],
          // === PreCompact: Notify before context compaction ===
          PreCompact: [{
            hooks: [
              async (params: unknown): Promise<Record<string, unknown>> => {
                const p = params as { trigger?: 'manual' | 'auto' };
                this.options.onMessage({
                  type: 'preCompact',
                  trigger: p.trigger || 'auto',
                });
                return {};
              },
            ],
          }],
        },
      };

      // Add resume option to continue conversation
      // Use resumeSessionId (from explicit resume) or existing sessionId (for continuation)
      const sessionToResume = this.resumeSessionId || this.sessionId;
      if (sessionToResume) {
        (queryOptions as Record<string, unknown>).resume = sessionToResume;
        if (this.resumeSessionId) {
          this.resumeSessionId = null;
        }
      }

      const result = query({
        prompt,
        options: queryOptions,
      });

      // Store query reference for control methods
      this.currentQuery = result;

      // Fetch account info (includes subscription type)
      try {
        const account = await result.accountInfo();
        this.options.onMessage({
          type: 'accountInfo',
          data: {
            email: account.email,
            subscriptionType: account.subscriptionType,
            apiKeySource: account.apiKeySource,
          } as AccountInfo,
        });
      } catch {
        // Account info not available
      }

      // Get budget settings for warning/exceeded checks
      const budgetLimit = maxBudgetUsd;

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

            log('[ClaudeSession] Assistant message id:', message.message.id);
            log('[ClaudeSession] Raw content:', message.message.content);

            // If we have pending content from a DIFFERENT message, flush it first
            // This ensures each distinct assistant message appears in UI as it completes
            if (this.pendingAssistant && this.pendingAssistant.id !== message.message.id) {
              this.flushPendingAssistant();
              // Start fresh streaming content for the new message
              this.streamingContent = { messageId: message.message.id, thinking: '', text: '', isThinking: false, hasStreamedTools: false };
              log('[ClaudeSession] Started new streamingContent for message:', message.message.id);
            } else if (!this.streamingContent.messageId) {
              // First message - associate streaming content with this message ID
              this.streamingContent.messageId = message.message.id;
              log('[ClaudeSession] Associated streamingContent with message:', message.message.id);
            }

            const serializedContent = this.serializeContent(message.message.content);

            // Stream tool_use blocks immediately to UI (like partial does for thinking/text)
            // This ensures tool cards appear in real-time as tools are invoked
            // CRITICAL: Include messageId so webview associates tool with correct message
            for (const block of serializedContent) {
              if (block.type === 'tool_use') {
                log('[ClaudeSession] Sending toolStreaming:', block.name, block.id, 'for msg:', message.message.id);
                // Mark that we've streamed tools - after this, thinking updates should NOT be sent
                // This prevents the visual glitch of thinking text updating above tool cards
                this.streamingContent.hasStreamedTools = true;
                // Track this tool - if it never executes (no PreToolUse), it's "abandoned"
                this.streamedToolIds.set(block.id, { toolName: block.name, messageId: message.message.id });
                this.options.onMessage({
                  type: 'toolStreaming',
                  messageId: message.message.id,
                  tool: {
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  },
                });
              }
            }

            // Accumulate content within the same message ID
            if (!this.pendingAssistant) {
              this.pendingAssistant = {
                id: message.message.id,
                model: message.message.model,
                stopReason: message.message.stop_reason,
                content: serializedContent,
                sessionId: message.session_id,
              };
            } else {
              // Append new content blocks to same message
              this.pendingAssistant.content.push(...serializedContent);
              this.pendingAssistant.stopReason = message.message.stop_reason;
            }
            break;

          case 'stream_event': {
            const event = message.event as { type: string; delta?: { type: string; text?: string; thinking?: string } };
            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
                // Always accumulate thinking content (for final message)
                this.streamingContent.thinking += event.delta.thinking;
                this.streamingContent.isThinking = true;
                log('[ClaudeSession] stream_event: thinking_delta for msg:', this.streamingContent.messageId, 'length:', this.streamingContent.thinking.length, 'hasStreamedTools:', this.streamingContent.hasStreamedTools);
                // Only send partial updates if we haven't streamed tools yet
                // Once tools are visible, thinking content is "frozen" in the UI
                if (!this.streamingContent.hasStreamedTools) {
                  this.options.onMessage({
                    type: 'partial',
                    data: {
                      type: 'partial',
                      content: [],
                      session_id: this.sessionId || '',
                      messageId: this.streamingContent.messageId,
                      streamingThinking: this.streamingContent.thinking,
                      isThinking: true,
                    },
                  });
                }
              } else if (event.delta?.type === 'text_delta' && event.delta.text) {
                // Always accumulate text content (for final message)
                this.streamingContent.text += event.delta.text;
                this.streamingContent.isThinking = false;
                log('[ClaudeSession] stream_event: text_delta for msg:', this.streamingContent.messageId, 'length:', this.streamingContent.text.length, 'hasStreamedTools:', this.streamingContent.hasStreamedTools);
                // Only send partial updates if we haven't streamed tools yet
                if (!this.streamingContent.hasStreamedTools) {
                  this.options.onMessage({
                    type: 'partial',
                    data: {
                      type: 'partial',
                      content: [],
                      session_id: this.sessionId || '',
                      messageId: this.streamingContent.messageId,
                      streamingThinking: this.streamingContent.thinking,
                      streamingText: this.streamingContent.text,
                      isThinking: false,
                    },
                  });
                }
              }
            }
            break;
          }

          case 'system': {
            // Handle system messages (init, compact_boundary, etc.)
            const sysMsg = message as { subtype?: string; [key: string]: unknown };
            if (sysMsg.subtype === 'init') {
              const initData: SystemInitData = {
                model: (sysMsg.model as string) || '',
                tools: (sysMsg.tools as string[]) || [],
                mcpServers: (sysMsg.mcp_servers as { name: string; status: string }[]) || [],
                permissionMode: (sysMsg.permissionMode as string) || 'default',
                slashCommands: (sysMsg.slash_commands as string[]) || [],
                apiKeySource: (sysMsg.apiKeySource as string) || '',
                cwd: (sysMsg.cwd as string) || '',
                outputStyle: sysMsg.output_style as string | undefined,
              };
              this.options.onMessage({ type: 'systemInit', data: initData });
              // Also update account info with model
              this.options.onMessage({
                type: 'accountInfo',
                data: { model: initData.model, apiKeySource: initData.apiKeySource } as AccountInfo,
              });
            } else if (sysMsg.subtype === 'compact_boundary') {
              const metadata = sysMsg.compact_metadata as { trigger: 'manual' | 'auto'; pre_tokens: number } | undefined;
              if (metadata) {
                this.options.onMessage({
                  type: 'compactBoundary',
                  preTokens: metadata.pre_tokens,
                  trigger: metadata.trigger,
                });
              }
            }
            break;
          }

          case 'user': {
            // Handle user messages (including replays for resumed sessions)
            const userMsg = message as { uuid?: string; message?: { content?: unknown }; isReplay?: boolean; isSynthetic?: boolean };
            if (userMsg.uuid) {
              this.lastUserMessageId = userMsg.uuid;
            }
            // Send replayed user messages to UI
            if (userMsg.isReplay && userMsg.message?.content) {
              const content = Array.isArray(userMsg.message.content)
                ? userMsg.message.content
                    .filter((c): c is { type: 'text'; text: string } =>
                      typeof c === 'object' && c !== null && 'type' in c && c.type === 'text')
                    .map(c => c.text)
                    .join('')
                : typeof userMsg.message.content === 'string'
                  ? userMsg.message.content
                  : '';
              if (content) {
                this.options.onMessage({
                  type: 'userReplay',
                  content,
                  isSynthetic: userMsg.isSynthetic,
                });
              }
            }
            break;
          }

          case 'result': {
            const resultMsg = message as {
              subtype?: string;
              session_id: string;
              is_error?: boolean;
              total_cost_usd?: number;
              usage?: { input_tokens?: number; output_tokens?: number };
              num_turns?: number;
            };
            // Track accumulated cost
            if (resultMsg.total_cost_usd) {
              this.accumulatedCost = resultMsg.total_cost_usd;
            }
            // Check for budget exceeded
            if (resultMsg.subtype === 'error_max_budget_usd' && budgetLimit) {
              this.options.onMessage({
                type: 'budgetExceeded',
                finalSpend: resultMsg.total_cost_usd || 0,
                limit: budgetLimit,
              });
            }
            // Check for budget warning (>80%)
            if (budgetLimit && resultMsg.total_cost_usd) {
              const percentUsed = (resultMsg.total_cost_usd / budgetLimit) * 100;
              if (percentUsed >= 80 && percentUsed < 100) {
                this.options.onMessage({
                  type: 'budgetWarning',
                  currentSpend: resultMsg.total_cost_usd,
                  limit: budgetLimit,
                  percentUsed,
                });
              }
            }
            // Flush accumulated assistant message before signaling done
            this.flushPendingAssistant();
            this.options.onMessage({
              type: 'done',
              data: {
                type: 'result',
                session_id: resultMsg.session_id,
                is_done: !resultMsg.is_error,
                total_cost_usd: resultMsg.total_cost_usd,
                total_input_tokens: resultMsg.usage?.input_tokens,
                total_output_tokens: resultMsg.usage?.output_tokens,
                num_turns: resultMsg.num_turns,
              },
            });
            break;
          }
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
    this.currentQuery = null;
    this.lastUserMessageId = null;
    this.messageCheckpoints.clear();
    this.accumulatedCost = 0;
  }

  // === Control Methods ===

  async interrupt(): Promise<void> {
    if (this.currentQuery) {
      try {
        await this.currentQuery.interrupt();
      } catch {
        // Interrupt may fail if not in streaming input mode
      }
    }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (this.currentQuery) {
      try {
        await this.currentQuery.setPermissionMode(mode);
      } catch {
        // May fail if not in streaming input mode
      }
    }
  }

  async setModel(model?: string): Promise<void> {
    if (this.currentQuery) {
      try {
        await this.currentQuery.setModel(model);
      } catch {
        // May fail if not in streaming input mode
      }
    }
  }

  async setMaxThinkingTokens(tokens: number | null): Promise<void> {
    if (this.currentQuery) {
      try {
        await this.currentQuery.setMaxThinkingTokens(tokens);
      } catch {
        // May fail if not in streaming input mode
      }
    }
  }

  async getSupportedModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) {
      return this.cachedModels;
    }
    if (this.currentQuery) {
      try {
        const models = await this.currentQuery.supportedModels();
        this.cachedModels = models as ModelInfo[];
        return this.cachedModels;
      } catch {
        return [];
      }
    }
    return [];
  }

  async getSupportedCommands(): Promise<SlashCommandInfo[]> {
    if (this.currentQuery) {
      try {
        const commands = await this.currentQuery.supportedCommands();
        return commands as SlashCommandInfo[];
      } catch {
        return [];
      }
    }
    return [];
  }

  async getMcpServerStatus(): Promise<McpServerStatusInfo[]> {
    if (this.currentQuery) {
      try {
        const status = await this.currentQuery.mcpServerStatus();
        return status as McpServerStatusInfo[];
      } catch {
        return [];
      }
    }
    return [];
  }

  async rewindFiles(userMessageId: string): Promise<void> {
    if (this.currentQuery) {
      try {
        await this.currentQuery.rewindFiles(userMessageId);
        this.options.onMessage({
          type: 'rewindComplete',
          rewindToMessageId: userMessageId,
        });
      } catch (error) {
        this.options.onMessage({
          type: 'rewindError',
          message: error instanceof Error ? error.message : 'Rewind failed',
        });
      }
    } else {
      this.options.onMessage({
        type: 'rewindError',
        message: 'No active session to rewind',
      });
    }
  }

  getCheckpointForMessage(assistantMessageId: string): string | undefined {
    return this.messageCheckpoints.get(assistantMessageId);
  }

  getAccumulatedCost(): number {
    return this.accumulatedCost;
  }

  private serializeToolResult(result: unknown): string {
    if (result === null || result === undefined) {
      return '';
    }
    if (typeof result === 'string') {
      return result;
    }
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
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
      } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
        blocks.push({ type: 'thinking', thinking: b.thinking } satisfies ThinkingBlock);
      }
    }

    return blocks;
  }
}
