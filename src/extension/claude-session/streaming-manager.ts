import { log } from '../logger';
import { stripControlChars } from '../../shared/utils';
import { readLatestCompactSummary } from '../session';
import type {
  MessageCallbacks,
  PendingAssistantMessage,
  StreamingContent,
  Query,
} from './types';
import { createEmptyStreamingContent } from './types';
import { serializeContent, isLocalCommandOutput, isLocalCommandText, isToolResultMessage } from './utils';
import type { ToolManager } from './tool-manager';
import type { SystemInitData, AccountInfo } from '../../shared/types';

/** Callback interface for checkpoint tracking */
export interface CheckpointTracker {
  trackCheckpoint(assistantMessageId: string, userMessageId: string): void;
  updateCost(cost: number): void;
}

/** Callback for signaling turn completion */
export type TurnCompleteCallback = () => void;

/**
 * StreamingManager handles message processing and content accumulation.
 *
 * Responsibilities:
 * - Process SDK messages and route to webview
 * - Accumulate streaming content (thinking, text)
 * - Manage pending assistant messages
 * - Handle stream events for real-time updates
 */
export class StreamingManager {
  private _sessionId: string | null = null;
  private pendingAssistant: PendingAssistantMessage | null = null;
  private streamingContent: StreamingContent = createEmptyStreamingContent();
  private _lastUserMessageId: string | null = null;
  private _isProcessing = false;
  private _onTurnComplete: TurnCompleteCallback | null = null;
  private _silentAbort = false;
  private cwd: string;

  constructor(
    private callbacks: MessageCallbacks,
    private toolManager: ToolManager,
    private checkpointTracker: CheckpointTracker,
    cwd: string
  ) {
    this.cwd = cwd;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  set sessionId(value: string | null) {
    if (this._sessionId !== value) {
      this._sessionId = value;
      this.callbacks.onSessionIdChange?.(value);
    }
  }

  get lastUserMessageId(): string | null {
    return this._lastUserMessageId;
  }

  set lastUserMessageId(value: string | null) {
    this._lastUserMessageId = value;
  }

  get isProcessing(): boolean {
    return this._isProcessing;
  }

  set processing(value: boolean) {
    this._isProcessing = value;
    this.callbacks.onMessage({ type: 'processing', isProcessing: value });
  }

  get streamingText(): string {
    return this.streamingContent.text;
  }

  get currentStreamingContent(): StreamingContent {
    return this.streamingContent;
  }

  set onTurnComplete(callback: TurnCompleteCallback | null) {
    this._onTurnComplete = callback;
  }

  set silentAbort(value: boolean) {
    this._silentAbort = value;
  }

  /** Commit any accumulated streaming text to pending content */
  private commitStreamingText(): void {
    if (!this.streamingContent.text || !this.pendingAssistant) return;

    this.pendingAssistant.content.push({
      type: 'text',
      text: this.streamingContent.text,
    });
    this.streamingContent.text = '';
  }

  /** Flush accumulated assistant content to webview */
  flushPendingAssistant(): void {
    if (!this.pendingAssistant) return;

    const pending = this.pendingAssistant;
    this.pendingAssistant = null;

    if (this._lastUserMessageId) {
      this.checkpointTracker.trackCheckpoint(pending.id, this._lastUserMessageId);
    }

    this.toolManager.sendAbandonedTools(pending.id);

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
    this.callbacks.onMessage({
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

  /** Calculate thinking duration when transitioning out of thinking phase */
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

  /** Consume query messages in the background */
  async consumeQueryInBackground(
    result: Query,
    budgetLimit: number | null,
    abortSignal: AbortSignal,
    onComplete: () => void
  ): Promise<void> {
    let receivedResult = false;

    try {
      for await (const message of result) {
        if (abortSignal.aborted) {
          break;
        }
        const msg = message as { type: string };
        if (msg.type === 'result') {
          receivedResult = true;
        }
        this.processSDKMessage(message, budgetLimit);
      }
    } catch (err) {
      const shouldReport = err instanceof Error &&
        err.name !== 'AbortError' &&
        !this._silentAbort;
      if (shouldReport) {
        log('[StreamingManager] Query consumption error: %s\n%s', err.message, err.stack);
        this.callbacks.onMessage({
          type: 'error',
          message: err.message,
        });
      }
    } finally {
      this._silentAbort = false;
      onComplete();

      if (!receivedResult) {
        this.toolManager.sendAllAbandonedTools();

        this._isProcessing = false;
        this.callbacks.onMessage({ type: 'processing', isProcessing: false });
        if (this._onTurnComplete) {
          this._onTurnComplete();
          this._onTurnComplete = null;
        }
      }
    }
  }

  /** Process a single SDK message and route to webview */
  processSDKMessage(message: unknown, budgetLimit: number | null): void {
    const msg = message as { type: string; [key: string]: unknown };

    switch (msg.type) {
      case 'assistant':
        this.handleAssistantMessage(msg);
        break;
      case 'stream_event':
        this.handleStreamEvent(msg);
        break;
      case 'system':
        this.handleSystemMessage(msg);
        break;
      case 'user':
        this.handleUserMessage(msg);
        break;
      case 'result':
        this.handleResultMessage(msg, budgetLimit);
        break;
    }
  }

  /** Handle assistant message from SDK */
  private handleAssistantMessage(message: Record<string, unknown>): void {
    const msg = message as {
      message: { id: string; content: unknown[]; model: string; stop_reason: string | null };
      session_id: string;
      parent_tool_use_id?: string | null;
    };
    const parentToolUseId = msg.parent_tool_use_id ?? null;

    if (this._sessionId !== msg.session_id) {
      this.sessionId = msg.session_id;
    }

    if (isLocalCommandOutput(msg.message.content)) {
      log('[StreamingManager] Filtering out local command output');
      return;
    }

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

    const serializedContent = serializeContent(msg.message.content);
    const hasToolBlocks = serializedContent.some(b => b.type === 'tool_use');
    const hasAccumulatedText = hasToolBlocks && this.streamingContent.text;

    for (const block of serializedContent) {
      if (block.type === 'tool_use') {
        const duration = this.calculateThinkingDurationIfNeeded();
        if (duration !== null) {
          this.callbacks.onMessage({
            type: 'partial',
            data: {
              type: 'partial',
              content: [],
              session_id: this._sessionId || '',
              messageId: this.streamingContent.messageId,
              streamingThinking: this.streamingContent.thinking,
              isThinking: false,
              thinkingDuration: duration,
            },
            parentToolUseId,
          });
        }
        this.streamingContent.hasStreamedTools = true;
        this.toolManager.registerStreamedTool(block.id, {
          toolName: block.name,
          messageId: msg.message.id,
          parentToolUseId,
        });
        this.toolManager.queueToolInfo(block.name, { toolUseId: block.id, parentToolUseId });
        this.callbacks.onMessage({
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

    const nonTextContent = serializedContent.filter(b => b.type !== 'text');

    if (!this.pendingAssistant) {
      const initialContent: typeof serializedContent = [];
      if (hasAccumulatedText) {
        initialContent.push({ type: 'text' as const, text: this.streamingContent.text });
        this.streamingContent.text = '';
      }
      initialContent.push(...nonTextContent);
      this.pendingAssistant = {
        id: msg.message.id,
        model: msg.message.model,
        stopReason: msg.message.stop_reason,
        content: initialContent,
        sessionId: msg.session_id,
        parentToolUseId,
      };
    } else {
      if (hasAccumulatedText) {
        this.commitStreamingText();
      }
      this.pendingAssistant.content.push(...nonTextContent);
      this.pendingAssistant.stopReason = msg.message.stop_reason;
    }
  }

  /** Handle stream_event from SDK */
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
          this.callbacks.onMessage({
            type: 'partial',
            data: {
              type: 'partial',
              content: [],
              session_id: this._sessionId || '',
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
        if (isLocalCommandText(this.streamingContent.text)) {
          log('[StreamingManager] Filtering local command text from streaming');
          return;
        }
        this.callbacks.onMessage({
          type: 'partial',
          data: {
            type: 'partial',
            content: [],
            session_id: this._sessionId || '',
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

  /** Handle system message from SDK */
  private handleSystemMessage(message: Record<string, unknown>): void {
    const sysMsg = message as { subtype?: string; [key: string]: unknown };
    if (sysMsg.subtype === 'init') {
      const mcpServers = (sysMsg.mcp_servers as { name: string; status: string }[]) || [];
      const initData: SystemInitData = {
        model: (sysMsg.model as string) || '',
        tools: (sysMsg.tools as string[]) || [],
        mcpServers,
        permissionMode: (sysMsg.permissionMode as string) || 'default',
        slashCommands: (sysMsg.slash_commands as string[]) || [],
        apiKeySource: (sysMsg.apiKeySource as string) || '',
        cwd: (sysMsg.cwd as string) || '',
        outputStyle: sysMsg.output_style as string | undefined,
      };
      this.callbacks.onMessage({ type: 'systemInit', data: initData });
      this.callbacks.onMessage({
        type: 'accountInfo',
        data: { model: initData.model, apiKeySource: initData.apiKeySource } as AccountInfo,
      });
    } else if (sysMsg.subtype === 'compact_boundary') {
      log('[StreamingManager] Received compact_boundary system message');
      const metadata = (sysMsg.compactMetadata ?? sysMsg.compact_metadata) as
        | { trigger: 'manual' | 'auto'; preTokens?: number; pre_tokens?: number }
        | undefined;
      if (metadata) {
        log('[StreamingManager] Sending compactBoundary to webview: trigger=%s, preTokens=%d', metadata.trigger, metadata.preTokens ?? metadata.pre_tokens ?? 0);
        this.callbacks.onMessage({
          type: 'compactBoundary',
          preTokens: metadata.preTokens ?? metadata.pre_tokens ?? 0,
          trigger: metadata.trigger,
        });

        if (this._sessionId) {
          readLatestCompactSummary(this.cwd, this._sessionId)
            .then(summary => {
              if (summary) {
                log('[StreamingManager] Read compact summary from JSONL, length=%d', summary.length);
                this.callbacks.onMessage({
                  type: 'compactSummary',
                  summary,
                });
              } else {
                log('[StreamingManager] No compact summary found in JSONL');
              }
            })
            .catch(err => {
              log('[StreamingManager] Error reading compact summary: %s', err);
            });
        }
      }
    }
  }

  /** Handle user message from SDK */
  private handleUserMessage(message: Record<string, unknown>): void {
    const userMsg = message as {
      uuid?: string;
      message?: { content?: unknown };
      isReplay?: boolean;
      isSynthetic?: boolean;
      isCompactSummary?: boolean;
    };

    if (userMsg.uuid && !isToolResultMessage(userMsg.message?.content)) {
      this._lastUserMessageId = userMsg.uuid;
    }

    if (userMsg.isCompactSummary && userMsg.message?.content) {
      log('[StreamingManager] Received isCompactSummary message');
      const rawContent = typeof userMsg.message.content === 'string'
        ? userMsg.message.content
        : '';
      const summary = stripControlChars(rawContent);
      log('[StreamingManager] Compact summary length: %d', summary.length);
      if (summary) {
        log('[StreamingManager] Sending compactSummary to webview');
        this.callbacks.onMessage({
          type: 'compactSummary',
          summary,
        });
      }
      return;
    }

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

      if (content.startsWith('<local-command-')) {
        log('[StreamingManager] Skipping local command wrapper in userReplay: %s', content.substring(0, 50));
        return;
      }

      if (content) {
        this.callbacks.onMessage({
          type: 'userReplay',
          content,
          isSynthetic: userMsg.isSynthetic,
          sdkMessageId: userMsg.uuid,
        });
      }
    }
  }

  /** Handle result message from SDK */
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
      this.checkpointTracker.updateCost(resultMsg.total_cost_usd);
    }

    if (resultMsg.subtype === 'error_max_budget_usd' && budgetLimit) {
      this.callbacks.onMessage({
        type: 'budgetExceeded',
        finalSpend: resultMsg.total_cost_usd || 0,
        limit: budgetLimit,
      });
    }

    if (budgetLimit && resultMsg.total_cost_usd) {
      const percentUsed = (resultMsg.total_cost_usd / budgetLimit) * 100;
      if (percentUsed >= 80 && percentUsed < 100) {
        this.callbacks.onMessage({
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

    const hadToolsThisTurn = this.toolManager.hadToolsThisTurn;
    const divisor = hadToolsThisTurn ? 2 : 1;

    const inputTokens = resultMsg.usage?.input_tokens ?? 0;
    const cacheCreation = resultMsg.usage?.cache_creation_input_tokens ?? 0;
    const cacheRead = resultMsg.usage?.cache_read_input_tokens ?? 0;

    this.callbacks.onMessage({
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

    this.toolManager.resetTurn();
    this.streamingContent = createEmptyStreamingContent();
    this._isProcessing = false;
    this.callbacks.onMessage({ type: 'processing', isProcessing: false });

    if (this._onTurnComplete) {
      this._onTurnComplete();
      this._onTurnComplete = null;
    }
  }

  /** Reset streaming state */
  resetStreaming(): void {
    this.pendingAssistant = null;
    this.streamingContent = createEmptyStreamingContent();
    this._lastUserMessageId = null;
    this._isProcessing = false;
  }

  /** Reset turn-level state */
  resetTurn(): void {
    this.pendingAssistant = null;
    this.streamingContent = createEmptyStreamingContent();
  }
}
