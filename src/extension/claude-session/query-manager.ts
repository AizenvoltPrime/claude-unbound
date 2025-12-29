import * as vscode from 'vscode';
import { log } from '../logger';
import type {
  Query,
  SessionOptions,
  StreamingInputController,
  MessageCallbacks,
} from './types';
import { AGENT_DEFINITIONS } from './types';
import type { ToolManager } from './tool-manager';
import type { StreamingManager } from './streaming-manager';
import type { AccountInfo, ModelInfo, SlashCommandInfo, McpServerStatusInfo, PermissionMode, SandboxConfig } from '../../shared/types';

let queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query | undefined;

async function loadSDK() {
  if (!queryFn) {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    queryFn = sdk.query;
  }
  return queryFn;
}

/** Callbacks for SDK hooks */
export interface HookCallbacks {
  onFlush: () => void;
  onMessage: (message: import('../../shared/types').ExtensionToWebviewMessage) => void;
}

/**
 * QueryManager handles SDK query lifecycle and configuration.
 *
 * Responsibilities:
 * - Dynamic SDK import
 * - Create/maintain streaming queries
 * - Build SDK hooks configuration
 * - Model/permission/thinking token configuration
 * - Query methods (supportedModels, supportedCommands, mcpServerStatus)
 */
export class QueryManager {
  private abortController: AbortController | null = null;
  private _currentQuery: Query | null = null;
  private _sessionInitializing = false;
  private _streamingInputController: StreamingInputController | null = null;
  private _currentModel: string | null = null;
  private cachedModels: ModelInfo[] | null = null;
  private maxBudgetUsd: number | null = null;

  constructor(
    private options: SessionOptions,
    private callbacks: MessageCallbacks,
    private toolManager: ToolManager,
    private streamingManager: StreamingManager
  ) {}

  get query(): Query | null {
    return this._currentQuery;
  }

  get isInitializing(): boolean {
    return this._sessionInitializing;
  }

  get canRewind(): boolean {
    return this._currentQuery !== null;
  }

  get hasActiveQuery(): boolean {
    return this._streamingInputController !== null;
  }

  get currentModel(): string | null {
    return this._currentModel;
  }

  get abortSignal(): AbortSignal | null {
    return this.abortController?.signal ?? null;
  }

  /**
   * Ensure a streaming query exists for this session.
   * Uses streaming input mode (AsyncIterable) so the query stays alive between messages.
   *
   * Note: The SDK prompt parameter accepts string | AsyncIterable, but TypeScript types
   * don't properly reflect AsyncIterable support, requiring an `as unknown as string` cast.
   */
  async ensureStreamingQuery(
    resumeSessionId: string | undefined,
    pendingResumeAt: string | null
  ): Promise<void> {
    if (this._streamingInputController || this._sessionInitializing) {
      return;
    }

    this._sessionInitializing = true;

    const queryFn = await loadSDK();
    if (!queryFn) {
      this._sessionInitializing = false;
      return;
    }

    let resolveNext: ((content: string | null) => void) | null = null;

    type UserMessage = {
      type: 'user';
      message: { role: 'user'; content: string };
      parent_tool_use_id: null;
    };

    async function* inputStream(): AsyncGenerator<UserMessage, void, unknown> {
      while (true) {
        const content = await new Promise<string | null>(resolve => {
          resolveNext = resolve;
        });
        if (content === null) {
          break;
        }
        yield {
          type: 'user',
          message: { role: 'user', content },
          parent_tool_use_id: null,
        };
      }
    }

    this._streamingInputController = {
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

    const config = vscode.workspace.getConfiguration('claude-unbound');
    const maxTurns = config.get<number>('maxTurns', 50);
    const configuredModel = config.get<string>('model', '');
    const model = configuredModel || 'claude-opus-4-5-20251101';
    this.maxBudgetUsd = config.get<number | null>('maxBudgetUsd', null);
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
      ...(this.maxBudgetUsd && { maxBudgetUsd: this.maxBudgetUsd }),
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
        return this.toolManager.handleCanUseTool(
          toolName,
          input,
          context,
          () => this.streamingManager.flushPendingAssistant()
        );
      },
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      tools: { type: 'preset', preset: 'claude_code' },
      hooks: this.buildHooks(),
    };

    if (resumeSessionId) {
      queryOptions.resume = resumeSessionId;
    }

    if (pendingResumeAt) {
      queryOptions.resumeSessionAt = pendingResumeAt;
    }

    try {
      const result = queryFn({
        prompt: inputStream() as unknown as string,
        options: queryOptions as Parameters<typeof queryFn>[0]['options'],
      });

      this._currentQuery = result;
      this.abortController = queryOptions.abortController as AbortController;
      this._currentModel = model;
      this._sessionInitializing = false;

      result.setMaxThinkingTokens(maxThinkingTokens).catch((err) => {
        log('[QueryManager] Failed to set thinking tokens:', err);
      });

      result.accountInfo().then(
        (account) => {
          this.callbacks.onMessage({
            type: 'accountInfo',
            data: {
              email: account.email,
              subscriptionType: account.subscriptionType,
              apiKeySource: account.apiKeySource,
            } as AccountInfo,
          });
        },
        (err) => {
          log('[QueryManager] Failed to get account info:', err);
        }
      );

      this.streamingManager.consumeQueryInBackground(
        result,
        this.maxBudgetUsd,
        this.abortController.signal,
        () => {
          this._streamingInputController = null;
          this.streamingManager.onTurnComplete = null;
        }
      ).catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        log('[QueryManager] Background query consumption error: %s', msg);
      });

    } catch (err) {
      log('[QueryManager] Failed to create streaming query:', err);
      this._sessionInitializing = false;
      this._streamingInputController = null;
    }
  }

  /** Build hooks configuration for the query */
  private buildHooks() {
    return {
      PreToolUse: [{
        hooks: [
          async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
            const p = params as { tool_name?: string; tool_input?: unknown };
            this.toolManager.handlePreToolUse(p.tool_name, toolUseId, p.tool_input);
            return {};
          },
        ],
      }],
      PostToolUse: [{
        hooks: [
          async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
            const p = params as { tool_name?: string; tool_use_id?: string; tool_response?: unknown };
            const id = toolUseId ?? p.tool_use_id;
            this.toolManager.handlePostToolUse(p.tool_name, id, p.tool_response);
            return {};
          },
        ],
      }],
      PostToolUseFailure: [{
        hooks: [
          async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
            const p = params as { tool_name?: string; tool_use_id?: string; error?: string; is_interrupt?: boolean };
            const id = toolUseId ?? p.tool_use_id;
            this.toolManager.handlePostToolUseFailure(p.tool_name, id, p.error, p.is_interrupt);
            return {};
          },
        ],
      }],
      Notification: [{
        hooks: [
          async (params: unknown): Promise<Record<string, unknown>> => {
            const p = params as { message?: string; type?: string };
            if (p.message) {
              this.callbacks.onMessage({
                type: 'notification',
                message: p.message,
                notificationType: p.type || 'info',
              } as import('../../shared/types').ExtensionToWebviewMessage);
            }
            return {};
          },
        ],
      }],
      SessionStart: [{
        hooks: [
          async (params: unknown): Promise<Record<string, unknown>> => {
            const p = params as { source?: 'startup' | 'resume' | 'clear' | 'compact' };
            this.callbacks.onMessage({
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
            this.callbacks.onMessage({
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
              this.callbacks.onMessage({
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
              this.callbacks.onMessage({
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
            this.callbacks.onMessage({
              type: 'preCompact',
              trigger: p.trigger || 'auto',
            });
            return {};
          },
        ],
      }],
    };
  }

  /** Send message through streaming input controller */
  sendMessage(content: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.streamingManager.onTurnComplete = resolve;
      this._streamingInputController?.sendMessage(content);
    });
  }

  /** Abort the current query */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /** Interrupt the current query (may fail silently if query not in streaming mode) */
  async interrupt(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }

    if (this._currentQuery) {
      try {
        await this._currentQuery.interrupt();
      } catch (err) {
        log('[QueryManager] Interrupt failed (expected if not streaming):', err);
      }
    }
  }

  /** Close streaming input and reset query state */
  closeAndReset(): void {
    if (this._streamingInputController) {
      this._streamingInputController.close();
      this._streamingInputController = null;
    }
    this._currentQuery = null;
    this.abortController = null;
    this._sessionInitializing = false;
  }

  /** Full reset including cached data */
  reset(): void {
    this.abort();
    this.closeAndReset();
    this.cachedModels = null;
    this._currentModel = null;
    this.maxBudgetUsd = null;
  }

  /** Set permission mode (fails silently if query not active) */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (this._currentQuery) {
      try {
        await this._currentQuery.setPermissionMode(mode);
      } catch (err) {
        log('[QueryManager] setPermissionMode failed:', err);
      }
    }
  }

  /** Set model (fails silently if query not active) */
  async setModel(model?: string): Promise<void> {
    if (this._currentQuery) {
      try {
        await this._currentQuery.setModel(model);
      } catch (err) {
        log('[QueryManager] setModel failed:', err);
      }
    }
  }

  /** Set max thinking tokens (fails silently if query not active) */
  async setMaxThinkingTokens(tokens: number | null): Promise<void> {
    if (this._currentQuery) {
      try {
        await this._currentQuery.setMaxThinkingTokens(tokens);
      } catch (err) {
        log('[QueryManager] setMaxThinkingTokens failed:', err);
      }
    }
  }

  async getSupportedModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) {
      return this.cachedModels;
    }
    if (this._currentQuery) {
      try {
        const models = await this._currentQuery.supportedModels();
        this.cachedModels = models as ModelInfo[];
        return this.cachedModels;
      } catch (err) {
        log('[QueryManager] getSupportedModels failed:', err);
        return [];
      }
    }
    return [];
  }

  async getSupportedCommands(): Promise<SlashCommandInfo[]> {
    if (this._currentQuery) {
      try {
        const commands = await this._currentQuery.supportedCommands();
        return commands as SlashCommandInfo[];
      } catch (err) {
        log('[QueryManager] getSupportedCommands failed:', err);
        return [];
      }
    }
    return [];
  }

  async getMcpServerStatus(): Promise<McpServerStatusInfo[]> {
    if (this._currentQuery) {
      try {
        const status = await this._currentQuery.mcpServerStatus();
        return status as McpServerStatusInfo[];
      } catch (err) {
        log('[QueryManager] getMcpServerStatus failed:', err);
        return [];
      }
    }
    return [];
  }
}
