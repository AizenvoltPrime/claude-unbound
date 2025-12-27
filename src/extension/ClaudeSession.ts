import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { log } from './logger';
import { stripControlChars } from '../shared/utils';
import {
  persistInterruptMarker,
  persistUserMessage,
  persistPartialAssistant,
  findUserMessageInCurrentTurn,
  findLastMessageInCurrentTurn,
  getLastMessageUuid,
  initializeSession,
} from './SessionStorage';
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
  parentToolUseId: string | null;
}

interface StreamingContent {
  messageId: string | null;
  thinking: string;
  text: string;
  isThinking: boolean;
  hasStreamedTools: boolean;
  thinkingStartTime: number | null;
  thinkingDuration: number | null;
  parentToolUseId: string | null;
}

interface StreamedToolInfo {
  toolName: string;
  messageId: string;
  parentToolUseId: string | null;
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
  private streamingContent: StreamingContent = { messageId: null, thinking: '', text: '', isThinking: false, hasStreamedTools: false, thinkingStartTime: null, thinkingDuration: null, parentToolUseId: null };
  // Tracks tools that were streamed to UI - if they never reach PreToolUse/completion, they're "abandoned"
  private streamedToolIds: Map<string, StreamedToolInfo> = new Map();
  // FIFO queue for correlating toolStreaming with canUseTool (SDK doesn't pass tool_use_id in canUseTool context)
  private pendingToolQueue: Map<string, Array<{ toolUseId: string; parentToolUseId: string | null }>> = new Map();
  // Turn-level tracking: persists across messages within a single turn (reset in sendMessage)
  private toolsUsedThisTurn = false;
  // Track current prompt and model for interrupt handling
  private currentPrompt: string | null = null;
  private currentModel: string | null = null;
  private wasInterrupted = false;

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
          parentToolUseId: info.parentToolUseId,
        });
        this.streamedToolIds.delete(toolUseId);
      }
    }

    // Merge any accumulated streaming content into the pending message
    // This handles the case where we're interrupted mid-stream:
    // The SDK sends assistant messages incrementally (first thinking, then text),
    // but if interrupted before the final message, streamingContent has content
    // that pendingAssistant doesn't. We need to merge them.
    if (this.streamingContent.messageId === pending.id) {
      const hasThinkingInPending = pending.content.some(b => b.type === 'thinking');
      const hasTextInPending = pending.content.some(b => b.type === 'text');

      if (!hasThinkingInPending && this.streamingContent.thinking) {
        pending.content.unshift({ type: 'thinking', thinking: this.streamingContent.thinking });
      }
      if (!hasTextInPending && this.streamingContent.text) {
        pending.content.push({ type: 'text', text: this.streamingContent.text });
      }
    }

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
      parentToolUseId: pending.parentToolUseId,
    });
  }

  /**
   * Calculate and store thinking duration when transitioning out of thinking phase.
   * Called when first tool or text arrives after thinking content.
   * Returns the calculated duration, or null if not applicable.
   */
  private calculateThinkingDurationIfNeeded(): number | null {
    if (this.streamingContent.isThinking &&
        this.streamingContent.thinkingStartTime &&
        !this.streamingContent.thinkingDuration) {
      this.streamingContent.thinkingDuration = Math.max(1,
        Math.round((Date.now() - this.streamingContent.thinkingStartTime) / 1000));
      this.streamingContent.isThinking = false;
      return this.streamingContent.thinkingDuration;
    }
    return null;
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
    this.streamingContent = { messageId: null, thinking: '', text: '', isThinking: false, hasStreamedTools: false, thinkingStartTime: null, thinkingDuration: null, parentToolUseId: null };
    this.toolsUsedThisTurn = false;
    this.currentPrompt = prompt;
    this.wasInterrupted = false;
    this.options.onMessage({ type: 'processing', isProcessing: true });

    try {
      const config = vscode.workspace.getConfiguration('claude-unbound');
      const maxTurns = config.get<number>('maxTurns', 50);
      // Default to Opus 4.5 if no model is specified
      const configuredModel = config.get<string>('model', '');
      const model = configuredModel || 'claude-opus-4-5-20251101';
      this.currentModel = model;
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

          // SDK doesn't pass tool_use_id in canUseTool context, so we use FIFO queue correlation
          // toolStreaming queues tool info, canUseTool dequeues it (tools are processed in order)
          // This works because SDK awaits each canUseTool before processing the next tool
          const toolQueue = this.pendingToolQueue.get(toolName) ?? [];
          const queuedInfo = toolQueue.shift();
          if (queuedInfo) {
            this.pendingToolQueue.set(toolName, toolQueue);
          } else {
            log('[ClaudeSession] Warning: canUseTool called but no queued info for tool %s - timing mismatch?', toolName);
          }
          const toolUseId = queuedInfo?.toolUseId ?? null;
          const parentToolUseId = queuedInfo?.parentToolUseId ?? null;

          const extendedContext = { ...context, toolUseID: toolUseId, parentToolUseId };
          const result = await this.options.permissionHandler.canUseTool(toolName, input, extendedContext);
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
            this.streamedToolIds.delete(toolUseId);
            log('[ClaudeSession] Tool denied, sending toolFailed:', toolName, toolUseId);
            this.options.onMessage({
              type: 'toolFailed',
              toolUseId,
              toolName,
              error: result.message ?? 'Permission denied',
              isInterrupt: false,
              parentToolUseId,
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
                if (p.tool_name) {
                  this.toolsUsedThisTurn = true;
                }
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
                const p = params as { tool_name?: string; tool_use_id?: string; tool_response?: unknown };
                const id = toolUseId ?? p.tool_use_id;
                if (p.tool_name && id) {
                  const toolInfo = this.streamedToolIds.get(id);
                  const parentToolUseId = toolInfo?.parentToolUseId ?? null;
                  // Remove from orphan tracking (just in case PreToolUse didn't fire)
                  this.streamedToolIds.delete(id);
                  this.options.onMessage({
                    type: 'toolCompleted',
                    toolUseId: id,
                    toolName: p.tool_name,
                    result: this.serializeToolResult(p.tool_response),
                    parentToolUseId,
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
                const p = params as { tool_name?: string; tool_use_id?: string; error?: string; is_interrupt?: boolean };
                const id = toolUseId ?? p.tool_use_id;
                if (p.tool_name && id) {
                  const toolInfo = this.streamedToolIds.get(id);
                  const parentToolUseId = toolInfo?.parentToolUseId ?? null;
                  // Remove from orphan tracking
                  this.streamedToolIds.delete(id);
                  this.options.onMessage({
                    type: 'toolFailed',
                    toolUseId: id,
                    toolName: p.tool_name,
                    error: p.error || 'Unknown error',
                    isInterrupt: p.is_interrupt,
                    parentToolUseId,
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

      // Handle session ID for new vs existing sessions
      const isNewSession = !this.sessionId && !this.resumeSessionId;
      if (!isNewSession) {
        // For explicit resumes or continuations, pass the resume option
        const sessionToResume = this.resumeSessionId || this.sessionId;
        if (sessionToResume) {
          (queryOptions as Record<string, unknown>).resume = sessionToResume;
          if (this.resumeSessionId) {
            this.resumeSessionId = null;
          }
        }
      }

      const result = query({
        prompt,
        options: queryOptions,
      });

      // Store query reference for control methods
      this.currentQuery = result;

      // SDK "streaming input mode" methods must be called AFTER the stream starts.
      // We fire these off without awaiting - they'll execute once streaming begins.
      result.setMaxThinkingTokens(maxThinkingTokens).catch((err) => {
        log('[ClaudeSession] Failed to set thinking tokens:', err);
      });

      result.accountInfo().then(
        (account) => {
          this.options.onMessage({
            type: 'accountInfo',
            data: {
              email: account.email,
              subscriptionType: account.subscriptionType,
              apiKeySource: account.apiKeySource,
            } as AccountInfo,
          });
        },
        (err) => {
          log('[ClaudeSession] Failed to get account info:', err);
        }
      );

      // Get budget settings for warning/exceeded checks
      const budgetLimit = maxBudgetUsd;

      for await (const message of result) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        switch (message.type) {
          case 'assistant': {
            const parentToolUseId = (message as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null;

            if (this.sessionId !== message.session_id) {
              this.sessionId = message.session_id;
              this.options.onSessionIdChange?.(this.sessionId);
            }

            // If we have pending content from a DIFFERENT message, flush it first
            // This ensures each distinct assistant message appears in UI as it completes
            if (this.pendingAssistant && this.pendingAssistant.id !== message.message.id) {
              this.flushPendingAssistant();
              // Only reset streamingContent if not already set by message_start
              if (this.streamingContent.messageId !== message.message.id) {
                this.streamingContent = { messageId: message.message.id, thinking: '', text: '', isThinking: false, hasStreamedTools: false, thinkingStartTime: null, thinkingDuration: null, parentToolUseId };
              }
            } else if (!this.streamingContent.messageId) {
              // Fallback: associate streaming content if message_start wasn't received
              this.streamingContent.messageId = message.message.id;
              this.streamingContent.parentToolUseId = parentToolUseId;
            }

            const serializedContent = this.serializeContent(message.message.content);

            // Stream tool_use blocks immediately to UI (like partial does for thinking/text)
            // This ensures tool cards appear in real-time as tools are invoked
            // CRITICAL: Include messageId so webview associates tool with correct message
            for (const block of serializedContent) {
              if (block.type === 'tool_use') {
                // Calculate thinking duration when transitioning from thinking to tools
                const duration = this.calculateThinkingDurationIfNeeded();
                if (duration !== null) {
                  // Send a partial update with the duration before the first tool
                  this.options.onMessage({
                    type: 'partial',
                    data: {
                      type: 'partial',
                      content: [],
                      session_id: this.sessionId || '',
                      messageId: this.streamingContent.messageId,
                      streamingThinking: this.streamingContent.thinking,
                      isThinking: false,
                      thinkingDuration: duration,
                    },
                    parentToolUseId,
                  });
                }
                // Mark that we've streamed tools - after this, thinking updates should NOT be sent
                // This prevents the visual glitch of thinking text updating above tool cards
                this.streamingContent.hasStreamedTools = true;
                // Track this tool - if it never executes (no PreToolUse), it's "abandoned"
                this.streamedToolIds.set(block.id, { toolName: block.name, messageId: message.message.id, parentToolUseId });
                // Queue for canUseTool correlation (SDK doesn't pass tool_use_id in canUseTool context)
                const toolQueue = this.pendingToolQueue.get(block.name) ?? [];
                toolQueue.push({ toolUseId: block.id, parentToolUseId });
                this.pendingToolQueue.set(block.name, toolQueue);
                this.options.onMessage({
                  type: 'toolStreaming',
                  messageId: message.message.id,
                  tool: {
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  },
                  parentToolUseId,
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
                parentToolUseId,
              };
            } else {
              // Append new content blocks to same message
              this.pendingAssistant.content.push(...serializedContent);
              this.pendingAssistant.stopReason = message.message.stop_reason;
            }
            break;
          }

          case 'stream_event': {
            const streamParentToolUseId = (message as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null;
            const event = message.event as {
              type: string;
              message?: { id: string };
              delta?: { type: string; text?: string; thinking?: string };
            };

            // Handle message_start FIRST to capture the message ID before any deltas arrive
            // This ensures all partial events have a valid messageId
            if (event.type === 'message_start' && event.message?.id) {
              if (this.streamingContent.messageId && this.streamingContent.messageId !== event.message.id) {
                // New message starting - flush any pending content from previous message
                this.flushPendingAssistant();
              }
              this.streamingContent = {
                messageId: event.message.id,
                thinking: '',
                text: '',
                isThinking: false,
                hasStreamedTools: false,
                thinkingStartTime: null,
                thinkingDuration: null,
                parentToolUseId: streamParentToolUseId,
              };
            }

            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
                // Start timing when first thinking delta arrives
                if (!this.streamingContent.thinkingStartTime) {
                  this.streamingContent.thinkingStartTime = Date.now();
                }
                // Always accumulate thinking content (for final message)
                this.streamingContent.thinking += event.delta.thinking;
                this.streamingContent.isThinking = true;
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
                    parentToolUseId: this.streamingContent.parentToolUseId,
                  });
                }
              } else if (event.delta?.type === 'text_delta' && event.delta.text) {
                // Calculate thinking duration when transitioning from thinking to text
                this.calculateThinkingDurationIfNeeded();
                // Always accumulate text content (for final message)
                this.streamingContent.text += event.delta.text;
                // ALWAYS stream text deltas - this is the final response and should appear in real-time
                // (unlike thinking which is frozen once tools appear to avoid visual glitches above tool cards)
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
                    thinkingDuration: this.streamingContent.thinkingDuration ?? undefined,
                  },
                  parentToolUseId: this.streamingContent.parentToolUseId,
                });
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
              const rawContent = Array.isArray(userMsg.message.content)
                ? userMsg.message.content
                    .filter((c): c is { type: 'text'; text: string } =>
                      typeof c === 'object' && c !== null && 'type' in c && c.type === 'text')
                    .map(c => c.text)
                    .join('')
                : typeof userMsg.message.content === 'string'
                  ? userMsg.message.content
                  : '';
              const content = stripControlChars(rawContent);
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
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
              };
              num_turns?: number;
              modelUsage?: Record<string, { contextWindow?: number }>;
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
            // Extract context window size from modelUsage (first model's contextWindow)
            const contextWindowSize = resultMsg.modelUsage
              ? Object.values(resultMsg.modelUsage)[0]?.contextWindow ?? 200000
              : 200000;

            // When tools are used, the SDK sums context from multiple API requests:
            // 1. First request: Claude decides to use tool(s)
            // 2. Second request: Claude processes tool result(s)
            // This causes ~2x inflation for single-tool turns. With N tools it's (N+1)x,
            // but divide-by-2 is a reasonable approximation for the common single-tool case.
            // TODO: Track actual tool count for more accurate normalization
            // Note: Use turn-level tracking because streamingContent resets on new message IDs
            const hadToolsThisTurn = this.toolsUsedThisTurn;
            const divisor = hadToolsThisTurn ? 2 : 1;

            const inputTokens = resultMsg.usage?.input_tokens ?? 0;
            const cacheCreation = resultMsg.usage?.cache_creation_input_tokens ?? 0;
            const cacheRead = resultMsg.usage?.cache_read_input_tokens ?? 0;

            this.options.onMessage({
              type: 'done',
              data: {
                type: 'result',
                session_id: resultMsg.session_id,
                is_done: !resultMsg.is_error,
                total_cost_usd: resultMsg.total_cost_usd,
                total_input_tokens: Math.round(inputTokens / divisor),
                cache_creation_tokens: Math.round(cacheCreation / divisor),
                cache_read_tokens: Math.round(cacheRead / divisor),
                total_output_tokens: resultMsg.usage?.output_tokens,
                num_turns: resultMsg.num_turns,
                context_window_size: contextWindowSize,
              },
            });
            break;
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage) {
        this.options.onMessage({
          type: 'error',
          message: errorMessage,
        });
      }
    } finally {
      // Flush any pending assistant content so partial responses are shown
      this.flushPendingAssistant();

      // Handle interrupt persistence - ensure user message and interrupt marker are written
      if (this.wasInterrupted && this.currentPrompt) {
        try {
          // If we don't have a session ID yet (interrupted before SDK sent one),
          // generate one now and create the session file
          if (!this.sessionId) {
            this.sessionId = crypto.randomUUID();
            await initializeSession(this.options.cwd, this.sessionId);
            this.options.onSessionIdChange?.(this.sessionId);
          }

          // Use FILE STATE as source of truth - SDK may write to file before we receive stream messages
          // Wait for SDK file writes to settle with exponential backoff
          let sdkUserMessage: { uuid: string; content: string } | null = null;

          for (let attempt = 0; attempt < 5; attempt++) {
            sdkUserMessage = await findUserMessageInCurrentTurn(this.options.cwd, this.sessionId);
            if (sdkUserMessage && sdkUserMessage.content.trim() === this.currentPrompt.trim()) break;

            // Exponential backoff: 20ms, 40ms, 80ms, 160ms, 320ms
            await new Promise(resolve => setTimeout(resolve, 20 * Math.pow(2, attempt)));
          }

          const sdkWroteUserMessage = sdkUserMessage && sdkUserMessage.content.trim() === this.currentPrompt.trim();

          if (sdkWroteUserMessage && sdkUserMessage) {
            // SDK wrote user message for this turn - find last message to chain interrupt to
            const lastMsgUuid = await findLastMessageInCurrentTurn(this.options.cwd, this.sessionId);

            // Chain partial text (if any) and interrupt to the last SDK message
            let lastUuidForChain = lastMsgUuid ?? sdkUserMessage.uuid;

            if (this.streamingContent.text && lastUuidForChain) {
              const partialUuid = await persistPartialAssistant({
                workspacePath: this.options.cwd,
                sessionId: this.sessionId,
                parentUuid: lastUuidForChain,
                text: this.streamingContent.text,
                model: this.currentModel ?? undefined,
              });
              lastUuidForChain = partialUuid;
            }

            if (lastUuidForChain) {
              const interruptUuid = await persistInterruptMarker({
                workspacePath: this.options.cwd,
                sessionId: this.sessionId,
                parentUuid: lastUuidForChain,
              });
              this.lastUserMessageId = interruptUuid;
            } else {
              log('[ClaudeSession] Warning: Could not determine parent UUID for interrupt marker - SDK message chain may be corrupted');
            }

          } else {
            // SDK didn't write user message for this turn - write one ourselves
            let parentUuid = this.lastUserMessageId;
            if (!parentUuid) {
              parentUuid = await getLastMessageUuid(this.options.cwd, this.sessionId);
            }

            const userMessageUuid = await persistUserMessage({
              workspacePath: this.options.cwd,
              sessionId: this.sessionId,
              content: this.currentPrompt,
              parentUuid: parentUuid ?? undefined,
            });

            // Chain interrupt to user message (no partial since SDK never started)
            const interruptUuid = await persistInterruptMarker({
              workspacePath: this.options.cwd,
              sessionId: this.sessionId,
              parentUuid: userMessageUuid,
            });
            this.lastUserMessageId = interruptUuid;
          }
        } catch (err) {
          log('[ClaudeSession] Error persisting interrupt:', err);
        }
      } else if (this.sessionId) {
        // Normal completion - sync our parent tracking with the SDK's chain
        try {
          const lastUuid = await getLastMessageUuid(this.options.cwd, this.sessionId);
          if (lastUuid) {
            this.lastUserMessageId = lastUuid;
          }
        } catch {
          // Ignore read errors
        }
      }

      // Clear streaming state
      this.currentPrompt = null;
      this.streamingContent = { messageId: null, thinking: '', text: '', isThinking: false, hasStreamedTools: false, thinkingStartTime: null, thinkingDuration: null, parentToolUseId: null };
      this.streamedToolIds.clear();
      this.pendingToolQueue.clear();

      if (this.wasInterrupted) {
        this.options.onMessage({ type: 'sessionCancelled' });
      }

      this.isProcessing = false;
      this.abortController = null;
      this.options.onMessage({ type: 'processing', isProcessing: false });
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.wasInterrupted = true;
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
    this.wasInterrupted = true;

    if (this.abortController) {
      this.abortController.abort();
    }

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
