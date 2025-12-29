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
  getMessageParentUuid,
  initializeSession,
  readLatestCompactSummary,
} from './session';
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

// Controller for streaming input mode - allows sending messages to an active query
interface StreamingInputController {
  sendMessage: (content: string) => void;
  close: () => void;
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
  // Streaming input controller - used for ALL sessions (not just resumed)
  // This keeps the query transport alive for rewindFiles() and other operations
  private streamingInputController: StreamingInputController | null = null;
  private sessionInitializing = false;
  // Resolve function to signal when a message has been fully processed
  private messageProcessedResolve: (() => void) | null = null;
  // When set, the next query will fork from this message UUID via resumeSessionAt
  // This is used for "code-and-conversation" rewind to fork the conversation tree
  // Also exposed via conversationHead getter for rewind history filtering
  private pendingResumeSessionAt: string | null = null;

  constructor(private options: SessionOptions) {}

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  get processing(): boolean {
    return this.isProcessing;
  }

  get canRewindFiles(): boolean {
    return this.currentQuery !== null;
  }

  get conversationHead(): string | null {
    return this.pendingResumeSessionAt;
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
    // For resumed sessions, initialize streaming query immediately so rewind is available
    if (sessionId) {
      this.ensureStreamingQuery(sessionId).catch(err => {
        log('[ClaudeSession] Failed to initialize resumed session:', err);
      });
    }
  }

  /**
   * Ensure a streaming query exists for this session.
   * Uses streaming input mode (AsyncIterable) so the query stays alive between messages.
   * This is required for rewindFiles() and other Query methods to work.
   *
   * Per SDK docs: prompt can be `string | AsyncIterable<SDKUserMessage>`.
   * Streaming input mode keeps the transport open, enabling methods like rewindFiles().
   */
  private async ensureStreamingQuery(resumeSessionId?: string): Promise<void> {
    if (this.streamingInputController || this.sessionInitializing) {
      return;
    }

    this.sessionInitializing = true;

    const queryFn = await loadSDK();
    if (!queryFn) {
      this.sessionInitializing = false;
      return;
    }

    // Create a streaming input controller
    let resolveNext: ((content: string | null) => void) | null = null;

    // SDKUserMessage format for streaming input
    type UserMessage = {
      type: 'user';
      message: { role: 'user'; content: string };
      parent_tool_use_id: null;
    };

    // Async generator that yields user messages as they come in
    // This keeps the query alive between messages
    async function* inputStream(): AsyncGenerator<UserMessage, void, unknown> {
      while (true) {
        const content = await new Promise<string | null>(resolve => {
          resolveNext = resolve;
        });
        if (content === null) {
          break; // Stream closed
        }
        yield {
          type: 'user',
          message: { role: 'user', content },
          parent_tool_use_id: null,
        };
      }
    }

    this.streamingInputController = {
      sendMessage: (content: string) => {
        if (resolveNext) {
          resolveNext(content);
        }
      },
      close: () => {
        if (resolveNext) {
          resolveNext(null);
        }
      },
    };

    // Build query options
    const config = vscode.workspace.getConfiguration('claude-unbound');
    const maxTurns = config.get<number>('maxTurns', 50);
    const configuredModel = config.get<string>('model', '');
    const model = configuredModel || 'claude-opus-4-5-20251101';
    const maxBudgetUsd = config.get<number | null>('maxBudgetUsd', null);
    const maxThinkingTokens = config.get<number | null>('maxThinkingTokens', null);
    const betasEnabledRaw = config.get<string[]>('betasEnabled', []);
    const betasEnabled = betasEnabledRaw.filter(
      (b): b is 'context-1m-2025-08-07' => b === 'context-1m-2025-08-07'
    );
    const enableFileCheckpointing = config.get<boolean>('enableFileCheckpointing', true);
    const sandboxConfig = config.get<SandboxConfig>('sandbox', { enabled: false });

    const queryOptions: Record<string, unknown> = {
      cwd: this.options.cwd,
      abortController: new AbortController(),
      includePartialMessages: true,
      maxTurns,
      model,
      ...(maxBudgetUsd && { maxBudgetUsd }),
      ...(maxThinkingTokens && { maxThinkingTokens }),
      ...(betasEnabled.length > 0 && { betas: betasEnabled }),
      enableFileCheckpointing,
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
      ...(this.options.mcpServers && Object.keys(this.options.mcpServers).length > 0 && {
        mcpServers: this.options.mcpServers,
      }),
      agents: AGENT_DEFINITIONS,
      canUseTool: async (toolName: string, input: Record<string, unknown>, context: { signal: AbortSignal }) => {
        return this.handleCanUseTool(toolName, input, context);
      },
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      tools: { type: 'preset', preset: 'claude_code' },
      hooks: this.buildHooks(),
    };

    // Resume existing session or start fresh
    if (resumeSessionId) {
      queryOptions.resume = resumeSessionId;
    }

    // Fork conversation from a specific message (used after "code-and-conversation" rewind)
    // Per SDK docs: resumeSessionAt resumes session at a specific message UUID, creating a fork
    if (this.pendingResumeSessionAt) {
      queryOptions.resumeSessionAt = this.pendingResumeSessionAt;
      this.pendingResumeSessionAt = null; // Clear after use
    }

    try {

      const result = queryFn({
        prompt: inputStream() as unknown as string,
        options: queryOptions as Parameters<typeof queryFn>[0]['options'],
      });

      this.currentQuery = result;
      this.abortController = queryOptions.abortController as AbortController;
      this.currentModel = model;
      this.sessionInitializing = false;

      // Set thinking tokens
      result.setMaxThinkingTokens(maxThinkingTokens).catch((err) => {
        log('[ClaudeSession] Failed to set thinking tokens:', err);
      });

      // Get account info
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

      // Start consuming messages in the background
      this.consumeQueryInBackground(result, maxBudgetUsd).catch(err => {
        log('[ClaudeSession] Background query consumption error:', err);
      });

    } catch (err) {
      log('[ClaudeSession] Failed to create streaming query:', err);
      this.sessionInitializing = false;
      this.streamingInputController = null;
    }
  }

  /**
   * Build hooks configuration for the query.
   */
  private buildHooks() {
    return {
      PreToolUse: [{
        hooks: [
          async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
            const p = params as { tool_name?: string; tool_input?: unknown };
            if (p.tool_name) {
              this.toolsUsedThisTurn = true;
            }
            if (p.tool_name && toolUseId) {
              this.streamedToolIds.delete(toolUseId);
              this.options.onMessage({
                type: 'toolPending',
                toolName: p.tool_name,
                input: p.tool_input,
              });
            }
            return {};
          },
        ],
      }],
      PostToolUse: [{
        hooks: [
          async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
            const p = params as { tool_name?: string; tool_use_id?: string; tool_response?: unknown };
            const id = toolUseId ?? p.tool_use_id;
            if (p.tool_name && id) {
              const toolInfo = this.streamedToolIds.get(id);
              const parentToolUseId = toolInfo?.parentToolUseId ?? null;
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
      PostToolUseFailure: [{
        hooks: [
          async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
            const p = params as { tool_name?: string; tool_use_id?: string; error?: string; is_interrupt?: boolean };
            const id = toolUseId ?? p.tool_use_id;
            if (p.tool_name && id) {
              const toolInfo = this.streamedToolIds.get(id);
              const parentToolUseId = toolInfo?.parentToolUseId ?? null;
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
    };
  }

  /**
   * Handle canUseTool callback for permission checking.
   */
  private async handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    context: { signal: AbortSignal }
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> {
    // Flush any accumulated text/thinking content
    this.flushPendingAssistant();

    // Correlate with queued tool info
    const toolQueue = this.pendingToolQueue.get(toolName) ?? [];
    const queuedInfo = toolQueue.shift();
    if (queuedInfo) {
      this.pendingToolQueue.set(toolName, toolQueue);
    } else {
      log('[ClaudeSession] Warning: canUseTool called but no queued info for tool %s', toolName);
    }
    const toolUseId = queuedInfo?.toolUseId ?? null;
    const parentToolUseId = queuedInfo?.parentToolUseId ?? null;

    const extendedContext = { ...context, toolUseID: toolUseId, parentToolUseId };
    const result = await this.options.permissionHandler.canUseTool(toolName, input, extendedContext);

    if (result.behavior === 'allow') {
      if (toolUseId) {
        this.streamedToolIds.delete(toolUseId);
      }
      return {
        behavior: 'allow' as const,
        updatedInput: (result.updatedInput ?? input) as Record<string, unknown>,
      };
    }

    // Tool was denied
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
  }

  /**
   * Consume query messages in the background (streaming input mode).
   * Processes all SDK messages and routes them to the webview.
   */
  private async consumeQueryInBackground(result: Query, budgetLimit: number | null): Promise<void> {
    try {
      for await (const message of result) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        this.processSDKMessage(message, budgetLimit);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        log('[ClaudeSession] Query consumption error:', err);
        this.options.onMessage({
          type: 'error',
          message: err.message,
        });
      }
    } finally {
      // Clean up and signal message completion
      this.streamingInputController = null;
      if (this.messageProcessedResolve) {
        this.messageProcessedResolve();
        this.messageProcessedResolve = null;
      }
    }
  }

  /**
   * Process a single SDK message and route it to the webview.
   */
  private processSDKMessage(message: unknown, budgetLimit: number | null): void {
    const msg = message as { type: string; [key: string]: unknown };

    switch (msg.type) {
      case 'assistant': {
        this.handleAssistantMessage(msg);
        break;
      }
      case 'stream_event': {
        this.handleStreamEvent(msg);
        break;
      }
      case 'system': {
        this.handleSystemMessage(msg);
        break;
      }
      case 'user': {
        this.handleUserMessage(msg);
        break;
      }
      case 'result': {
        this.handleResultMessage(msg, budgetLimit);
        break;
      }
    }
  }

  /**
   * Handle assistant message from SDK.
   */
  private handleAssistantMessage(message: Record<string, unknown>): void {
    const msg = message as {
      message: { id: string; content: unknown[]; model: string; stop_reason: string | null };
      session_id: string;
      parent_tool_use_id?: string | null;
    };
    const parentToolUseId = msg.parent_tool_use_id ?? null;

    if (this.sessionId !== msg.session_id) {
      this.sessionId = msg.session_id;
      this.options.onSessionIdChange?.(this.sessionId);
    }

    // Filter out CLI internal output (e.g., callback completion messages)
    // Same check as history loading in ChatPanelProvider
    if (this.isLocalCommandOutput(msg.message.content)) {
      log('[ClaudeSession] Filtering out local command output');
      return;
    }

    // Flush pending content from a different message
    if (this.pendingAssistant && this.pendingAssistant.id !== msg.message.id) {
      this.flushPendingAssistant();
      if (this.streamingContent.messageId !== msg.message.id) {
        this.streamingContent = {
          messageId: msg.message.id,
          thinking: '',
          text: '',
          isThinking: false,
          hasStreamedTools: false,
          thinkingStartTime: null,
          thinkingDuration: null,
          parentToolUseId,
        };
      }
    } else if (!this.streamingContent.messageId) {
      this.streamingContent.messageId = msg.message.id;
      this.streamingContent.parentToolUseId = parentToolUseId;
    }

    const serializedContent = this.serializeContent(msg.message.content);

    // Stream tool_use blocks immediately
    for (const block of serializedContent) {
      if (block.type === 'tool_use') {
        const duration = this.calculateThinkingDurationIfNeeded();
        if (duration !== null) {
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
        this.streamingContent.hasStreamedTools = true;
        this.streamedToolIds.set(block.id, {
          toolName: block.name,
          messageId: msg.message.id,
          parentToolUseId,
        });
        const toolQueue = this.pendingToolQueue.get(block.name) ?? [];
        toolQueue.push({ toolUseId: block.id, parentToolUseId });
        this.pendingToolQueue.set(block.name, toolQueue);
        this.options.onMessage({
          type: 'toolStreaming',
          messageId: msg.message.id,
          tool: {
            id: block.id,
            name: block.name,
            input: block.input,
          },
          parentToolUseId,
        });
      }
    }

    // Accumulate content
    if (!this.pendingAssistant) {
      this.pendingAssistant = {
        id: msg.message.id,
        model: msg.message.model,
        stopReason: msg.message.stop_reason,
        content: serializedContent,
        sessionId: msg.session_id,
        parentToolUseId,
      };
    } else {
      this.pendingAssistant.content.push(...serializedContent);
      this.pendingAssistant.stopReason = msg.message.stop_reason;
    }
  }

  /**
   * Handle stream_event from SDK.
   */
  private handleStreamEvent(message: Record<string, unknown>): void {
    const streamParentToolUseId = (message.parent_tool_use_id as string | null) ?? null;
    const event = message.event as {
      type: string;
      message?: { id: string };
      delta?: { type: string; text?: string; thinking?: string };
    };

    if (event.type === 'message_start' && event.message?.id) {
      if (this.streamingContent.messageId && this.streamingContent.messageId !== event.message.id) {
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
        if (!this.streamingContent.thinkingStartTime) {
          this.streamingContent.thinkingStartTime = Date.now();
        }
        this.streamingContent.thinking += event.delta.thinking;
        this.streamingContent.isThinking = true;
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
        this.calculateThinkingDurationIfNeeded();
        this.streamingContent.text += event.delta.text;
        // Skip CLI internal output (e.g., callback completion messages)
        if (this.isLocalCommandText(this.streamingContent.text)) {
          log('[ClaudeSession] Filtering local command text from streaming');
          return;
        }
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
  }

  /**
   * Handle system message from SDK.
   */
  private handleSystemMessage(message: Record<string, unknown>): void {
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
      this.options.onMessage({
        type: 'accountInfo',
        data: { model: initData.model, apiKeySource: initData.apiKeySource } as AccountInfo,
      });
    } else if (sysMsg.subtype === 'compact_boundary') {
      log('[ClaudeSession] Received compact_boundary system message');
      const metadata = (sysMsg.compactMetadata ?? sysMsg.compact_metadata) as
        | { trigger: 'manual' | 'auto'; preTokens?: number; pre_tokens?: number }
        | undefined;
      if (metadata) {
        log('[ClaudeSession] Sending compactBoundary to webview: trigger=%s, preTokens=%d', metadata.trigger, metadata.preTokens ?? metadata.pre_tokens ?? 0);
        this.options.onMessage({
          type: 'compactBoundary',
          preTokens: metadata.preTokens ?? metadata.pre_tokens ?? 0,
          trigger: metadata.trigger,
        });

        // SDK doesn't stream isCompactSummary during live compacts, read from JSONL
        if (this.sessionId) {
          readLatestCompactSummary(this.options.cwd, this.sessionId)
            .then(summary => {
              if (summary) {
                log('[ClaudeSession] Read compact summary from JSONL, length=%d', summary.length);
                this.options.onMessage({
                  type: 'compactSummary',
                  summary,
                });
              } else {
                log('[ClaudeSession] No compact summary found in JSONL');
              }
            })
            .catch(err => {
              log('[ClaudeSession] Error reading compact summary: %s', err);
            });
        }
      }
    }
  }

  /**
   * Check if message content is a tool_result (not actual user input).
   * The SDK uses type: "user" for both actual user messages and tool results.
   */
  private isToolResultMessage(content: unknown): boolean {
    if (!Array.isArray(content)) return false;
    return content.some(block =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      (block as { type: string }).type === 'tool_result'
    );
  }

  /**
   * Handle user message from SDK.
   * Note: The SDK only emits type:"user" streaming events for:
   *   - Replays (isReplay: true) when resuming a session
   *   - Tool results (content contains tool_result blocks)
   * For live messages, we read UUID from session file in sendMessage().
   */
  private handleUserMessage(message: Record<string, unknown>): void {
    const userMsg = message as {
      uuid?: string;
      message?: { content?: unknown };
      isReplay?: boolean;
      isSynthetic?: boolean;
      isCompactSummary?: boolean;
    };

    // Track UUID for non-tool-result messages
    if (userMsg.uuid && !this.isToolResultMessage(userMsg.message?.content)) {
      this.lastUserMessageId = userMsg.uuid;
    }

    // Handle compact summary message (follows compact_boundary)
    if (userMsg.isCompactSummary && userMsg.message?.content) {
      log('[ClaudeSession] Received isCompactSummary message');
      const rawContent = typeof userMsg.message.content === 'string'
        ? userMsg.message.content
        : '';
      const summary = stripControlChars(rawContent);
      log('[ClaudeSession] Compact summary length: %d', summary.length);
      if (summary) {
        log('[ClaudeSession] Sending compactSummary to webview');
        this.options.onMessage({
          type: 'compactSummary',
          summary,
        });
      }
      return;
    }

    // Handle replayed user messages (session resume)
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

      // Skip local command wrappers (CLI internal) - matches history loading filter
      if (content.startsWith('<local-command-')) {
        log('[ClaudeSession] Skipping local command wrapper in userReplay: %s', content.substring(0, 50));
        return;
      }

      if (content) {
        this.options.onMessage({
          type: 'userReplay',
          content,
          isSynthetic: userMsg.isSynthetic,
          sdkMessageId: userMsg.uuid,
        });
      }
    }
  }

  /**
   * Handle result message from SDK.
   */
  private handleResultMessage(message: Record<string, unknown>, budgetLimit: number | null): void {
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

    if (resultMsg.total_cost_usd) {
      this.accumulatedCost = resultMsg.total_cost_usd;
    }

    if (resultMsg.subtype === 'error_max_budget_usd' && budgetLimit) {
      this.options.onMessage({
        type: 'budgetExceeded',
        finalSpend: resultMsg.total_cost_usd || 0,
        limit: budgetLimit,
      });
    }

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

    this.flushPendingAssistant();

    const contextWindowSize = resultMsg.modelUsage
      ? Object.values(resultMsg.modelUsage)[0]?.contextWindow ?? 200000
      : 200000;

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

    // Signal that message processing is complete
    if (this.messageProcessedResolve) {
      this.messageProcessedResolve();
      this.messageProcessedResolve = null;
    }

    // Reset turn-level state for next message
    this.toolsUsedThisTurn = false;
    this.streamingContent = {
      messageId: null,
      thinking: '',
      text: '',
      isThinking: false,
      hasStreamedTools: false,
      thinkingStartTime: null,
      thinkingDuration: null,
      parentToolUseId: null,
    };
    this.streamedToolIds.clear();
    this.pendingToolQueue.clear();
    this.isProcessing = false;
    this.options.onMessage({ type: 'processing', isProcessing: false });
  }

  /**
   * Send a message to Claude using streaming input mode.
   * This ensures the query stays alive for rewindFiles() and other operations.
   *
   * Per SDK docs: Using AsyncIterable<SDKUserMessage> as prompt enables streaming
   * input mode, which keeps the query transport open between messages.
   */
  async sendMessage(prompt: string, agentId?: string): Promise<void> {
    if (this.isProcessing) {
      this.options.onMessage({
        type: 'error',
        message: 'A request is already in progress',
      });
      return;
    }

    // Determine if this is a fresh session or continuing/resuming
    const sessionToResume = this.resumeSessionId || this.sessionId;

    // Ensure streaming query exists
    await this.ensureStreamingQuery(sessionToResume ?? undefined);

    if (!this.streamingInputController) {
      this.options.onMessage({
        type: 'error',
        message: 'Failed to initialize streaming query',
      });
      return;
    }

    // Clear resume ID since we've used it
    if (this.resumeSessionId) {
      this.resumeSessionId = null;
    }

    this.isProcessing = true;
    this.pendingAssistant = null;
    this.toolsUsedThisTurn = false;
    this.currentPrompt = prompt;
    this.wasInterrupted = false;
    // Note: pendingResumeSessionAt is cleared in ensureStreamingQuery after being used
    this.options.onMessage({ type: 'processing', isProcessing: true });

    // Create a promise that will be resolved when the message is processed
    const messageProcessed = new Promise<void>((resolve) => {
      this.messageProcessedResolve = resolve;
    });

    // Send the message through the streaming input controller
    this.streamingInputController.sendMessage(prompt);

    // Wait for the message to be processed
    await messageProcessed;

    // Read and send the user message UUID from session file
    // The SDK doesn't emit user message events during live streaming - only for replays/tool results
    // So we must read the UUID from the persisted session file
    if (this.currentPrompt && this.sessionId && !this.wasInterrupted) {
      try {
        let sdkUserMessage: { uuid: string; content: string } | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          sdkUserMessage = await findUserMessageInCurrentTurn(this.options.cwd, this.sessionId);
          if (sdkUserMessage && sdkUserMessage.content.trim() === this.currentPrompt.trim()) break;
          await new Promise(resolve => setTimeout(resolve, 20 * Math.pow(2, attempt)));
        }

        if (sdkUserMessage && sdkUserMessage.content.trim() === this.currentPrompt.trim()) {
          this.lastUserMessageId = sdkUserMessage.uuid;
          this.options.onMessage({
            type: 'userMessageIdAssigned',
            sdkMessageId: sdkUserMessage.uuid,
          });
        }
      } catch (err) {
        log('[ClaudeSession] Error reading user message UUID from session file:', err);
      }
    }

    // Handle interrupt persistence if needed
    if (this.wasInterrupted && this.currentPrompt && this.sessionId) {
      try {
        let sdkUserMessage: { uuid: string; content: string } | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          sdkUserMessage = await findUserMessageInCurrentTurn(this.options.cwd, this.sessionId);
          if (sdkUserMessage && sdkUserMessage.content.trim() === this.currentPrompt.trim()) break;
          await new Promise(resolve => setTimeout(resolve, 20 * Math.pow(2, attempt)));
        }

        const sdkWroteUserMessage = sdkUserMessage && sdkUserMessage.content.trim() === this.currentPrompt.trim();

        if (sdkWroteUserMessage && sdkUserMessage) {
          const lastMsgUuid = await findLastMessageInCurrentTurn(this.options.cwd, this.sessionId);
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
          }
        } else {
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
      try {
        const lastUuid = await getLastMessageUuid(this.options.cwd, this.sessionId);
        if (lastUuid) {
          this.lastUserMessageId = lastUuid;
        }
      } catch {
        // Ignore read errors
      }
    }

    this.currentPrompt = null;
    if (this.wasInterrupted) {
      this.options.onMessage({ type: 'sessionCancelled' });
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
    // Close the streaming input controller if active
    if (this.streamingInputController) {
      this.streamingInputController.close();
      this.streamingInputController = null;
    }
    this.sessionId = null;
    this.resumeSessionId = null;
    this.currentQuery = null;
    this.lastUserMessageId = null;
    this.messageCheckpoints.clear();
    this.accumulatedCost = 0;
    this.sessionInitializing = false;
    this.pendingResumeSessionAt = null;
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

  /**
   * Rewind to a specific message with various restore options.
   *
   * Per SDK docs (file-checkpointing.md):
   * - rewindFiles() restores files on disk but does NOT rewind conversation
   * - resumeSessionAt forks conversation from a specific message UUID
   *
   * Options:
   * - 'code-and-conversation': Restore files + fork conversation (both)
   * - 'conversation-only': Fork conversation only (no file restore)
   * - 'code-only': Restore files only (conversation stays linear)
   *
   * IMPORTANT: Rewind uses REPLACE semantics - the target message and everything
   * after it are removed. The new message replaces the target, not appends after it.
   * To achieve this, we use the target's parentUuid for resumeSessionAt.
   */
  async rewindFiles(userMessageId: string, option: 'code-and-conversation' | 'conversation-only' | 'code-only' = 'code-only'): Promise<void> {
    const needsFileRewind = option === 'code-and-conversation' || option === 'code-only';
    const needsConversationFork = option === 'code-and-conversation' || option === 'conversation-only';

    try {
      if (needsFileRewind) {
        if (!this.currentQuery) {
          this.options.onMessage({
            type: 'rewindError',
            message: 'No active session to rewind files',
          });
          return;
        }
        await this.currentQuery.rewindFiles(userMessageId);
      }

      if (needsConversationFork) {
        if (!this.sessionId) {
          this.options.onMessage({
            type: 'rewindError',
            message: 'No active session for conversation fork',
          });
          return;
        }

        const parentUuid = await getMessageParentUuid(this.options.cwd, this.sessionId, userMessageId);

        if (!parentUuid) {
          if (this.streamingInputController) {
            this.streamingInputController.close();
            this.streamingInputController = null;
          }
          this.currentQuery = null;
          this.abortController = null;
          this.sessionId = null;
          this.resumeSessionId = null;
          this.sessionInitializing = false;
        } else {
          this.pendingResumeSessionAt = parentUuid;
          if (this.streamingInputController) {
            this.streamingInputController.close();
            this.streamingInputController = null;
          }
          this.currentQuery = null;
          this.abortController = null;
          this.sessionInitializing = false;
        }
      }

      this.options.onMessage({
        type: 'rewindComplete',
        rewindToMessageId: userMessageId,
        option,
      });
    } catch (error) {
      this.options.onMessage({
        type: 'rewindError',
        message: error instanceof Error ? error.message : 'Rewind failed',
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

  private isLocalCommandOutput(content: unknown[]): boolean {
    if (!Array.isArray(content) || content.length !== 1) return false;
    const block = content[0] as { type?: string; text?: string };
    if (block.type !== 'text' || typeof block.text !== 'string') return false;
    // Match CLI internal output wrappers - same check as history loading
    return block.text.trim().startsWith('<local-command-');
  }

  private isLocalCommandText(text: string): boolean {
    // Match CLI internal output wrappers - same check as history loading
    return text.trim().startsWith('<local-command-');
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
