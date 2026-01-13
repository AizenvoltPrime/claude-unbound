import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { log } from "../logger";
import { readThinkingTokensFromClaudeSettings } from "../claude-settings";
import { persistInjectedMessage, findLastMessageInCurrentTurn } from "../session";
import { extractTextFromContent, hasImageContent } from "../../shared/utils";
import type { Query, SessionOptions, StreamingInputController, MessageCallbacks, ContentInput } from "./types";
import type { ToolManager } from "./tool-manager";
import type { StreamingManager } from "./streaming-manager";
import type { AccountInfo, ModelInfo, SlashCommandInfo, McpServerStatusInfo, PermissionMode, SandboxConfig, PluginConfig } from "../../shared/types";
import type {
  PreToolUseHookInput,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
  NotificationHookInput,
  UserPromptSubmitHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  PreCompactHookInput,
} from "@anthropic-ai/claude-agent-sdk";

let queryFn: typeof import("@anthropic-ai/claude-agent-sdk").query | undefined;

async function loadSDK() {
  if (!queryFn) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    queryFn = sdk.query;
  }
  return queryFn;
}

/**
 * Detect Node version manager bin paths that may not be in the default PATH.
 * On Remote SSH, VS Code Server runs as a non-interactive process which doesn't
 * source shell config files (.bashrc, .profile, etc.) where NVM/FNM add their paths.
 */
async function detectNodeManagerPaths(): Promise<string[]> {
  if (process.platform === "win32") return [];

  const home = os.homedir();
  const additionalPaths: string[] = [];

  async function addVersionedPaths(baseDir: string, binSubpath: string): Promise<void> {
    try {
      const versions = await fs.promises.readdir(baseDir);
      for (const version of versions) {
        const binPath = path.join(baseDir, version, binSubpath);
        try {
          await fs.promises.access(binPath);
          additionalPaths.push(binPath);
        } catch {}
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log("[QueryManager] Failed to scan %s: %O", baseDir, err);
      }
    }
  }

  async function addSinglePath(binPath: string): Promise<void> {
    try {
      await fs.promises.access(binPath);
      additionalPaths.push(binPath);
    } catch {}
  }

  await Promise.all([
    addVersionedPaths(path.join(home, ".nvm", "versions", "node"), "bin"),
    addVersionedPaths(path.join(home, ".local", "share", "fnm", "node-versions"), "installation/bin"),
    addVersionedPaths("/usr/local/n/versions/node", "bin"),
    addSinglePath(path.join(home, ".volta", "bin")),
    addSinglePath(path.join(home, ".asdf", "shims")),
  ]);

  return additionalPaths;
}

/** Callbacks for SDK hooks */
export interface HookCallbacks {
  onFlush: () => void;
  onMessage: (message: import("../../shared/types").ExtensionToWebviewMessage) => void;
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
  private _queuedMessages: Array<{ id: string | null; content: ContentInput }> = [];

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
   * Resolve model name based on provider environment overrides.
   * Providers like Z.AI and OpenRouter use ANTHROPIC_DEFAULT_* env vars to map models.
   * Returns the provider's model if set, otherwise returns the original model.
   */
  private resolveModelForProvider(configuredModel: string): string {
    const env = this.options.providerEnv;
    if (!env) {
      return configuredModel;
    }

    // Match Claude model tiers explicitly (claude-opus-*, claude-sonnet-*, claude-haiku-*)
    let providerModel: string | undefined;

    if (/^claude-opus-/.test(configuredModel)) {
      providerModel = env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    } else if (/^claude-haiku-/.test(configuredModel)) {
      providerModel = env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    } else if (/^claude-sonnet-/.test(configuredModel)) {
      providerModel = env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    }

    if (providerModel) {
      return providerModel;
    }

    return configuredModel;
  }

  /**
   * Ensure a streaming query exists for this session.
   * Uses streaming input mode (AsyncIterable) so the query stays alive between messages.
   *
   * Note: The SDK prompt parameter accepts string | AsyncIterable, but TypeScript types
   * don't properly reflect AsyncIterable support, requiring an `as unknown as string` cast.
   */
  async ensureStreamingQuery(resumeSessionId: string | undefined, pendingResumeAt: string | null): Promise<void> {
    if (this._streamingInputController || this._sessionInitializing) {
      return;
    }

    this._sessionInitializing = true;

    const queryFn = await loadSDK();
    if (!queryFn) {
      this._sessionInitializing = false;
      return;
    }

    type UserMessage = {
      type: "user";
      message: { role: "user"; content: ContentInput };
      parent_tool_use_id: null;
    };

    let resolveNext: ((content: ContentInput | null) => void) | null = null;

    async function* inputStream(): AsyncGenerator<UserMessage, void, unknown> {
      while (true) {
        const content = await new Promise<ContentInput | null>((resolve) => {
          resolveNext = resolve;
        });
        if (content === null) {
          break;
        }
        yield {
          type: "user",
          message: { role: "user", content },
          parent_tool_use_id: null,
        };
      }
    }

    this._streamingInputController = {
      sendMessage: (content: ContentInput) => {
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

    const config = vscode.workspace.getConfiguration("claude-unbound");
    const maxTurns = config.get<number>("maxTurns", 100);
    const configuredModel = config.get<string>("model", "");

    // Resolve model: if provider profile sets ANTHROPIC_DEFAULT_* env vars, use those
    // This allows providers like Z.AI and OpenRouter to control model mapping
    const model = this.resolveModelForProvider(configuredModel || "claude-opus-4-5-20251101");
    this.maxBudgetUsd = config.get<number | null>("maxBudgetUsd", null);
    const maxThinkingTokens = await readThinkingTokensFromClaudeSettings();
    const betasEnabledRaw = config.get<string[]>("betasEnabled", []);
    const betasEnabled = betasEnabledRaw.filter((b): b is "context-1m-2025-08-07" => b === "context-1m-2025-08-07");
    const enableFileCheckpointing = config.get<boolean>("enableFileCheckpointing", true);
    const sandboxConfig = config.get<SandboxConfig>("sandbox", { enabled: false });

    // Detect Node version manager paths (NVM, FNM, Volta, etc.) that may not be in PATH
    // On Remote SSH, VS Code Server doesn't source shell configs where NVM adds its path
    const nodeManagerPaths = await detectNodeManagerPaths();
    const pathSeparator = process.platform === "win32" ? ";" : ":";
    const originalPath = process.env.PATH || "";
    const enhancedPath = nodeManagerPaths.length > 0
      ? [...nodeManagerPaths, originalPath].join(pathSeparator)
      : originalPath;

    const queryOptions: Record<string, unknown> = {
      cwd: this.options.cwd,
      abortController: new AbortController(),
      includePartialMessages: true,
      maxTurns,
      model,
      // Always pass process.env with enhanced PATH to ensure MCP servers can find npx/node
      // On Remote SSH, VS Code Server doesn't source shell configs where NVM adds its path
      env: {
        ...process.env,
        PATH: enhancedPath,
        ...(this.options.providerEnv || {}),
      },
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
      // Pass MCP servers explicitly - SDK doesn't auto-discover from settings
      ...(this.options.mcpServers &&
        Object.keys(this.options.mcpServers).length > 0 && {
          mcpServers: this.options.mcpServers,
        }),
      // Pass plugins explicitly - SDK doesn't auto-discover from standard locations
      ...(this.options.plugins &&
        this.options.plugins.length > 0 && {
          plugins: this.options.plugins,
        }),
      canUseTool: async (toolName: string, input: Record<string, unknown>, context: { signal: AbortSignal }) => {
        return this.toolManager.handleCanUseTool(toolName, input, context, () => this.streamingManager.flushPendingAssistant());
      },
      // Load all settings for hooks, CLAUDE.md, etc.
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      tools: { type: "preset", preset: "claude_code" },
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
        options: queryOptions as Parameters<typeof queryFn>[0]["options"],
      });

      this._currentQuery = result;
      this.abortController = queryOptions.abortController as AbortController;
      this._currentModel = model;
      this._sessionInitializing = false;

      result.setMaxThinkingTokens(maxThinkingTokens).catch((err) => {
        log("[QueryManager] Failed to set thinking tokens:", err);
      });

      result.accountInfo().then(
        (account) => {
          this.callbacks.onMessage({
            type: "accountInfo",
            data: {
              email: account.email,
              subscriptionType: account.subscriptionType,
              apiKeySource: account.apiKeySource,
            } as AccountInfo,
          });
        },
        (err) => {
          log("[QueryManager] Failed to get account info:", err);
        }
      );

      const controllerForThisQuery = this._streamingInputController;

      this.streamingManager.onTurnEndFlush = () => {
        this.flushQueuedMessagesAsNewTurn();
      };

      this.streamingManager
        .consumeQueryInBackground(result, this.maxBudgetUsd, this.abortController.signal, () => {
          if (this._streamingInputController === controllerForThisQuery) {
            this._streamingInputController = null;
          }
          this.streamingManager.onTurnComplete = null;
          this.streamingManager.onTurnEndFlush = null;
        })
        .catch((err) => {
          log("[QueryManager] Background query consumption error:", err);
        });
    } catch (err) {
      log("[QueryManager] Failed to create streaming query:", err);
      this._sessionInitializing = false;
      this._streamingInputController = null;
    }
  }

  /** Build hooks configuration for the query */
  private buildHooks() {
    return {
      PreToolUse: [
        {
          hooks: [
            async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
              const p = params as PreToolUseHookInput;
              this.toolManager.handlePreToolUse(p.tool_name, toolUseId, p.tool_input);
              return {};
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
              const p = params as PostToolUseHookInput;
              const id = toolUseId ?? p.tool_use_id;
              this.toolManager.handlePostToolUse(p.tool_name, id, p.tool_response);

              if (this._queuedMessages.length > 0) {
                const queueHasImages = this._queuedMessages.some((m) => hasImageContent(m.content));

                if (queueHasImages) {
                  log("[QueryManager] PostToolUse: queued messages contain images, deferring to turn-end flush");
                  return {};
                }

                const queued = this._queuedMessages.splice(0);
                const context = queued.map((m) => `[User interjection]: ${extractTextFromContent(m.content, "")}`).join("\n\n");
                log("[QueryManager] PostToolUse: injecting queued messages as additionalContext");

                const sessionId = this.streamingManager.sessionId;
                let parentUuid = this.streamingManager.lastUserMessageId;

                if (sessionId) {
                  const lastMsgUuid = await findLastMessageInCurrentTurn(this.options.cwd, sessionId);
                  if (lastMsgUuid) {
                    parentUuid = lastMsgUuid;
                  }
                }

                for (const msg of queued) {
                  if (sessionId) {
                    try {
                      await persistInjectedMessage({
                        workspacePath: this.options.cwd,
                        sessionId,
                        content: msg.content,
                        parentUuid,
                        uuid: msg.id ?? undefined,
                      });
                      if (msg.id) {
                        parentUuid = msg.id;
                      }
                    } catch (err) {
                      log("[QueryManager] Failed to persist injected message:", err);
                    }
                  }

                  if (msg.id) {
                    this.callbacks.onMessage({ type: "queueProcessed", messageId: msg.id });
                  }
                }

                return {
                  hookSpecificOutput: {
                    hookEventName: "PostToolUse",
                    additionalContext: context,
                  },
                };
              }
              return {};
            },
          ],
        },
      ],
      PostToolUseFailure: [
        {
          hooks: [
            async (params: unknown, toolUseId: string | undefined): Promise<Record<string, unknown>> => {
              const p = params as PostToolUseFailureHookInput;
              const id = toolUseId ?? p.tool_use_id;
              this.toolManager.handlePostToolUseFailure(p.tool_name, id, p.error, p.is_interrupt);
              return {};
            },
          ],
        },
      ],
      Notification: [
        {
          hooks: [
            async (params: unknown): Promise<Record<string, unknown>> => {
              const p = params as NotificationHookInput;
              if (p.message) {
                this.callbacks.onMessage({
                  type: "notification",
                  message: p.message,
                  notificationType: p.notification_type || "info",
                } as import("../../shared/types").ExtensionToWebviewMessage);
              }
              return {};
            },
          ],
        },
      ],
      SessionStart: [
        {
          hooks: [
            async (params: unknown): Promise<Record<string, unknown>> => {
              const p = params as SessionStartHookInput;
              this.callbacks.onMessage({
                type: "sessionStart",
                source: p.source || "startup",
              });
              return {};
            },
          ],
        },
      ],
      SessionEnd: [
        {
          hooks: [
            async (params: unknown): Promise<Record<string, unknown>> => {
              const p = params as SessionEndHookInput;
              this.callbacks.onMessage({
                type: "sessionEnd",
                reason: p.reason || "completed",
              });
              return {};
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            async (params: unknown): Promise<Record<string, unknown>> => {
              const p = params as UserPromptSubmitHookInput;
              if (this.options.permissionHandler.getPermissionMode() === "plan") {
                const planModeInstruction =
                  "<MANDATORY_INSTRUCTION>PLAN MODE ACTIVE: You MUST call EnterPlanMode immediately as your first action. No other tools or responses allowed until you enter plan mode.</MANDATORY_INSTRUCTION>";

                return {
                  hookSpecificOutput: {
                    hookEventName: "UserPromptSubmit",
                    additionalContext: planModeInstruction,
                  },
                };
              }
              return {};
            },
          ],
        },
      ],
      SubagentStart: [
        {
          hooks: [
            async (params: unknown): Promise<Record<string, unknown>> => {
              const p = params as SubagentStartHookInput;
              if (p.agent_id) {
                this.callbacks.onMessage({
                  type: "subagentStart",
                  agentId: p.agent_id,
                  agentType: p.agent_type || "unknown",
                });
              }
              return {};
            },
          ],
        },
      ],
      SubagentStop: [
        {
          hooks: [
            async (params: unknown): Promise<Record<string, unknown>> => {
              const p = params as SubagentStopHookInput;
              if (p.agent_id) {
                this.callbacks.onMessage({
                  type: "subagentStop",
                  agentId: p.agent_id,
                });
              }
              return {};
            },
          ],
        },
      ],
      PreCompact: [
        {
          hooks: [
            async (params: unknown): Promise<Record<string, unknown>> => {
              const p = params as PreCompactHookInput;
              this.callbacks.onMessage({
                type: "preCompact",
                trigger: p.trigger || "auto",
              });
              return {};
            },
          ],
        },
      ],
    };
  }

  /** Send message through streaming input controller */
  sendMessage(content: ContentInput): Promise<void> {
    return new Promise<void>((resolve) => {
      this.streamingManager.onTurnComplete = resolve;
      this._streamingInputController?.sendMessage(content);
    });
  }

  /**
   * Queue a message for injection at the next turn boundary via PostToolUse hook.
   *
   * Unlike sendMessage(), this does NOT create a new turn. Instead, the message
   * is injected as additionalContext in the PostToolUse hook, making it visible
   * to Claude within the current turn.
   *
   * This mirrors Claude Code CLI's h2A queue mechanism for mid-stream messages.
   */
  queueInput(content: ContentInput, messageId?: string): boolean {
    if (!this._streamingInputController) {
      log("[QueryManager] queueInput: no active query");
      return false;
    }
    log("[QueryManager] queueInput: queuing message for PostToolUse injection");
    this._queuedMessages.push({ id: messageId ?? null, content });
    return true;
  }

  /**
   * Flush any remaining queued messages as a new user turn.
   *
   * Called at turn end when PostToolUse hook didn't fire (text-only responses).
   * Combines all queued messages into a single message and sends via the
   * streaming input controller as a proper SDK turn.
   */
  flushQueuedMessagesAsNewTurn(): void {
    if (this._queuedMessages.length === 0 || !this._streamingInputController) {
      return;
    }

    const queued = this._queuedMessages.splice(0);
    log("[QueryManager] Flushing %d queued messages as new turn", queued.length);

    const combinedContent = this.combineQueuedContent(queued.map((m) => m.content));
    const displayText = extractTextFromContent(combinedContent);
    const contentBlocks = Array.isArray(combinedContent) ? combinedContent : undefined;

    const messageIds = queued.map((m) => m.id).filter((id): id is string => id !== null);
    if (messageIds.length > 0) {
      this.callbacks.onMessage({
        type: "queueBatchProcessed",
        messageIds,
        combinedContent: displayText,
        contentBlocks,
      });
    }

    this.streamingManager.processing = true;

    if (this.callbacks.onFlushedMessageComplete) {
      const callback = this.callbacks.onFlushedMessageComplete;
      this.streamingManager.onTurnComplete = () => {
        log("[QueryManager] Flushed turn complete, triggering UUID assignment");
        callback(displayText, messageIds).catch((err) => {
          log("[QueryManager] Error in onFlushedMessageComplete:", err);
        });
      };
    }

    this._streamingInputController.sendMessage(combinedContent);
  }

  private combineQueuedContent(contents: ContentInput[]): ContentInput {
    const hasMultimodal = contents.some((c) => Array.isArray(c));
    if (!hasMultimodal) {
      return (contents as string[]).join("\n\n");
    }

    const blocks: import("../../shared/types").UserContentBlock[] = [];
    for (let i = 0; i < contents.length; i++) {
      const content = contents[i];
      if (typeof content === "string") {
        if (i > 0) blocks.push({ type: "text", text: "\n\n" });
        blocks.push({ type: "text", text: content });
      } else {
        if (i > 0 && blocks.length > 0) {
          blocks.push({ type: "text", text: "\n\n" });
        }
        blocks.push(...content);
      }
    }
    return blocks;
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
        log("[QueryManager] Interrupt failed (expected if not streaming):", err);
      }
    }
  }

  /** Close streaming input and reset query state */
  closeAndReset(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this._streamingInputController) {
      this._streamingInputController.close();
      this._streamingInputController = null;
    }
    this._currentQuery = null;
    this._sessionInitializing = false;
    this._queuedMessages = [];
  }

  /** Full reset including cached data */
  reset(): void {
    this.abort();
    this.closeAndReset();
    this.cachedModels = null;
    this._currentModel = null;
    this.maxBudgetUsd = null;
  }

  /**
   * Update MCP servers configuration.
   * Called when user toggles MCP servers in the UI.
   */
  setMcpServers(mcpServers: Record<string, import("../../shared/types").McpServerConfig>): void {
    this.options.mcpServers = mcpServers;
  }

  /**
   * Close the query to trigger recreation with new MCP servers.
   * Must call setMcpServers() first to update the configuration.
   * Session ID is preserved - next query will resume.
   */
  restartForMcpChanges(): void {
    if (this._streamingInputController) {
      this.closeAndReset();
    }
  }

  /**
   * Update plugins configuration.
   * Called when user toggles plugins in the UI.
   */
  setPlugins(plugins: PluginConfig[]): void {
    this.options.plugins = plugins;
  }

  /**
   * Close the query to trigger recreation with new plugins.
   * Must call setPlugins() first to update the configuration.
   * Session ID is preserved - next query will resume.
   */
  restartForPluginChanges(): void {
    if (this._streamingInputController) {
      this.closeAndReset();
    }
  }

  /**
   * Update provider environment variables configuration.
   * Called when user switches provider profiles in the UI.
   */
  setProviderEnv(env: Record<string, string> | undefined): void {
    this.options.providerEnv = env;
  }

  /**
   * Close the query to trigger recreation with new provider env vars.
   * Must call setProviderEnv() first to update the configuration.
   * Session ID is preserved - next query will resume.
   */
  restartForProviderChange(): void {
    if (this._streamingInputController) {
      this.closeAndReset();
    }
  }

  /** Set permission mode (fails silently if query not active) */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (this._currentQuery) {
      try {
        await this._currentQuery.setPermissionMode(mode);
      } catch (err) {
        log("[QueryManager] setPermissionMode failed:", err);
      }
    }
  }

  /** Set model (fails silently if query not active) */
  async setModel(model?: string): Promise<void> {
    if (this._currentQuery) {
      try {
        await this._currentQuery.setModel(model);
      } catch (err) {
        log("[QueryManager] setModel failed:", err);
      }
    }
  }

  /** Set max thinking tokens (fails silently if query not active) */
  async setMaxThinkingTokens(tokens: number | null): Promise<void> {
    if (this._currentQuery) {
      try {
        await this._currentQuery.setMaxThinkingTokens(tokens);
      } catch (err) {
        log("[QueryManager] setMaxThinkingTokens failed:", err);
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
        log("[QueryManager] getSupportedModels failed:", err);
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
        log("[QueryManager] getSupportedCommands failed:", err);
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
        log("[QueryManager] getMcpServerStatus failed:", err);
        return [];
      }
    }
    return [];
  }
}
