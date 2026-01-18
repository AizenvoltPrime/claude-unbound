import * as vscode from "vscode";
import type { ClaudeSession } from "../claude-session";
import type { PermissionHandler } from "../PermissionHandler";
import type { StorageManager } from "./storage-manager";
import type { HistoryManager } from "./history-manager";
import type { SettingsManager } from "./settings-manager";
import type { WorkspaceManager } from "./workspace-manager";
import { createQueuedMessage } from "./queue-manager";
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage, RewindOption, UserContentBlock } from "../../shared/types";
import type { PanelInstance } from "./types";
import type { IdeContextManager } from "./ide-context-manager";
import { getSessionFilePath, getAgentFilePath, getSessionMetadata, renameSession, deleteSession, extractCommandHistory } from "../session";
import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { log } from "../logger";
import { extractTextFromContent, hasImageContent } from "../../shared/utils";

export interface MessageRouterConfig {
  workspacePath: string;
  postMessage: (panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage) => void;
  getPanels: () => Map<string, PanelInstance>;
  storageManager: StorageManager;
  historyManager: HistoryManager;
  settingsManager: SettingsManager;
  workspaceManager: WorkspaceManager;
  context: vscode.ExtensionContext;
}

const LANGUAGE_PREFERENCE_KEY = "userLanguagePreference";

interface HandlerContext {
  panel: vscode.WebviewPanel;
  session: ClaudeSession;
  permissionHandler: PermissionHandler;
  ideContextManager: IdeContextManager;
  panelId: string;
}

type MessageHandler = (message: WebviewToExtensionMessage, ctx: HandlerContext) => Promise<void> | void;

export class MessageRouter {
  private readonly workspacePath: string;
  private readonly postMessage: MessageRouterConfig["postMessage"];
  private readonly getPanels: MessageRouterConfig["getPanels"];
  private readonly storageManager: StorageManager;
  private readonly historyManager: HistoryManager;
  private readonly settingsManager: SettingsManager;
  private readonly workspaceManager: WorkspaceManager;
  private readonly context: vscode.ExtensionContext;
  private readonly handlers: Record<string, MessageHandler>;

  constructor(config: MessageRouterConfig) {
    this.workspacePath = config.workspacePath;
    this.postMessage = config.postMessage;
    this.getPanels = config.getPanels;
    this.storageManager = config.storageManager;
    this.historyManager = config.historyManager;
    this.settingsManager = config.settingsManager;
    this.workspaceManager = config.workspaceManager;
    this.context = config.context;
    this.handlers = this.buildHandlerRegistry();
  }

  private getLanguagePreference(): string {
    return this.context.globalState.get<string>(LANGUAGE_PREFERENCE_KEY) ?? vscode.env.language;
  }

  private async setLanguagePreference(locale: string): Promise<void> {
    await this.context.globalState.update(LANGUAGE_PREFERENCE_KEY, locale);
  }

  async handleWebviewMessage(message: WebviewToExtensionMessage, panelId: string): Promise<void> {
    const instance = this.getPanels().get(panelId);
    if (!instance) {
      log("[MessageRouter] No panel instance found for", panelId);
      return;
    }

    const ctx: HandlerContext = {
      panel: instance.panel,
      session: instance.session,
      permissionHandler: instance.permissionHandler,
      ideContextManager: instance.ideContextManager,
      panelId,
    };

    const handler = this.handlers[message.type];
    if (handler) {
      await handler(message, ctx);
    } else {
      log("[MessageRouter] Unhandled message type:", message.type);
    }
  }

  private buildHandlerRegistry(): Record<string, MessageHandler> {
    return {
      // Logging
      log: (msg) => {
        if (msg.type === "log") log("[Webview]", msg.message);
      },

      // Chat operations
      sendMessage: async (msg, ctx) => {
        if (msg.type !== "sendMessage") return;

        const msgContent = msg.content;
        const originalTextContent = extractTextFromContent(msgContent);
        if (!originalTextContent.trim() && !hasImageContent(msgContent)) return;

        // Detect and transform skill invocations: /skill-name [args]
        let transformedContent: string | null = null;
        let preApprovedSkillName: string | null = null;
        const skillMatch = originalTextContent.trim().match(/^\/([a-zA-Z0-9_:-]+)(?:\s+(.*))?$/);
        if (skillMatch) {
          const [, skillName, skillArgs] = skillMatch;
          const enabledPluginIds = this.settingsManager.getEnabledPluginIds();
          const isSkill = await this.workspaceManager.isSkill(skillName, enabledPluginIds);
          if (isSkill) {
            // Pre-approve since user explicitly invoked via slash command
            ctx.permissionHandler.preApproveSkill(skillName);
            preApprovedSkillName = skillName;
            // Transform to skill invocation
            transformedContent = skillArgs ? `Execute skill ${skillName}\nAdditional info: ${skillArgs}` : `Execute skill ${skillName}`;
          }
        }

        const correlationId = `corr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const contentBlocks = hasImageContent(msgContent) ? (msgContent as UserContentBlock[]) : undefined;
        this.postMessage(ctx.panel, { type: "userMessage", content: originalTextContent, contentBlocks, correlationId });

        if (originalTextContent.trim()) {
          this.storageManager.broadcastCommandHistoryEntry(originalTextContent.trim());
        }

        // Use transformed content for skill invocations, original for everything else
        // Apply IDE context to both transformed and original content when requested
        const baseContent = transformedContent ?? msgContent;
        const finalContent = msg.includeIdeContext ? ctx.ideContextManager.buildContentBlocks(baseContent) : baseContent;

        try {
          await ctx.session.sendMessage(finalContent, msg.agentId, correlationId);
        } catch (err) {
          // Revoke pre-approval if message failed to send
          if (preApprovedSkillName) {
            ctx.permissionHandler.revokeSkillPreApproval(preApprovedSkillName);
          }
          throw err;
        }
      },

      cancelSession: (_msg, ctx) => {
        ctx.session.cancel();
      },

      clearSession: (_msg, ctx) => {
        ctx.session.clear();
        this.postMessage(ctx.panel, { type: "conversationCleared" });
      },

      queueMessage: async (msg, ctx) => {
        if (msg.type !== "queueMessage") return;

        const msgContent = msg.content;
        const textContent = extractTextFromContent(msgContent);
        if (!textContent.trim() && !hasImageContent(msgContent)) return;

        const queuedMessage = createQueuedMessage(msgContent);
        const injected = ctx.session.queueInput(msgContent, queuedMessage.id);

        if (injected) {
          this.postMessage(ctx.panel, { type: "messageQueued", message: queuedMessage });
          if (textContent.trim()) {
            this.storageManager.broadcastCommandHistoryEntry(textContent.trim());
          }
        } else {
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Cannot send mid-stream message: no active streaming session"),
            notificationType: "error",
          });
        }
      },

      cancelQueuedMessage: async () => {
        // SDK-injected messages cannot be cancelled
      },

      resumeSession: async (msg, ctx) => {
        if (msg.type !== "resumeSession" || !msg.sessionId) return;

        ctx.session.setResumeSession(msg.sessionId);

        try {
          await this.historyManager.loadSessionHistory(msg.sessionId, ctx.panel);
          this.postMessage(ctx.panel, { type: "sessionStarted", sessionId: msg.sessionId });
        } catch (err) {
          log("[MessageRouter] Error loading session history:", err);
          this.postMessage(ctx.panel, { type: "sessionStarted", sessionId: msg.sessionId });
        }
      },

      interrupt: async (msg, ctx) => {
        await ctx.session.interrupt();
      },

      // Permission handling
      approveEdit: (msg, ctx) => {
        if (msg.type !== "approveEdit") return;
        ctx.permissionHandler.resolveApproval(msg.toolUseId, msg.approved, {
          customMessage: msg.customMessage,
        });
      },

      answerQuestion: (msg, ctx) => {
        if (msg.type !== "answerQuestion") return;
        ctx.permissionHandler.resolveQuestion(msg.toolUseId, msg.answers);
      },

      approvePlan: async (msg, ctx) => {
        if (msg.type !== "approvePlan") return;

        if (msg.clearContext && msg.approved && msg.planContent) {
          const currentSessionId = ctx.session.currentSessionId;

          ctx.permissionHandler.resolvePlanApproval(msg.toolUseId, false, {
            feedback: "User chose to clear context and start fresh",
          });

          const transcriptPath = currentSessionId
            ? await getSessionFilePath(this.workspacePath, currentSessionId)
            : null;

          const newMessage = buildPlanImplementationMessage(msg.planContent, transcriptPath);
          const correlationId = `plan-impl-${Date.now()}`;

          this.postMessage(ctx.panel, {
            type: "sessionCleared",
            pendingMessage: { content: newMessage, correlationId },
          });

          await this.settingsManager.handleSetPermissionMode(ctx.session, ctx.permissionHandler, "acceptEdits");
          await this.settingsManager.sendCurrentSettings(ctx.panel, ctx.permissionHandler);

          ctx.session.setPendingPlanBind(msg.planContent);
          ctx.session.reset();
          await ctx.session.sendMessage(newMessage, undefined, correlationId);

          return;
        }

        // Existing approval logic
        ctx.permissionHandler.resolvePlanApproval(msg.toolUseId, msg.approved, {
          approvalMode: msg.approvalMode,
          feedback: msg.feedback,
        });

        if (msg.approved && msg.approvalMode) {
          const newMode = msg.approvalMode === "acceptEdits" ? "acceptEdits" : "default";
          await this.settingsManager.handleSetPermissionMode(ctx.session, ctx.permissionHandler, newMode);
          await this.settingsManager.sendCurrentSettings(ctx.panel, ctx.permissionHandler);
        }
      },

      approveEnterPlanMode: async (msg, ctx) => {
        if (msg.type !== "approveEnterPlanMode") return;
        ctx.permissionHandler.resolveEnterPlanApproval(msg.toolUseId, msg.approved, {
          customMessage: msg.customMessage,
        });

        if (msg.approved) {
          await this.settingsManager.handleSetPermissionMode(ctx.session, ctx.permissionHandler, "plan");
          await this.settingsManager.sendCurrentSettings(ctx.panel, ctx.permissionHandler);
        }
      },

      approveSkill: (msg, ctx) => {
        if (msg.type !== "approveSkill") return;
        ctx.permissionHandler.resolveSkillApproval(msg.toolUseId, msg.approved, {
          approvalMode: msg.approvalMode,
          customMessage: msg.customMessage,
        });
      },

      // Initialization
      ready: async (msg, ctx) => {
        try {
          const { sessions, hasMore, nextOffset } = await this.storageManager.getStoredSessions();
          this.postMessage(ctx.panel, {
            type: "storedSessions",
            sessions,
            hasMore,
            nextOffset,
            isFirstPage: true,
          });
        } catch (err) {
          log("[MessageRouter] Error fetching sessions:", err);
        }

        await this.settingsManager.sendCurrentSettings(ctx.panel, ctx.permissionHandler);
        this.settingsManager.sendAvailableModels(ctx.session, ctx.panel);
        this.settingsManager.sendMcpConfig(ctx.panel);
        this.settingsManager.sendPluginConfig(ctx.panel);
        this.settingsManager.sendProviderProfilesForPanel(ctx.panel, ctx.panelId);
        this.postMessage(ctx.panel, { type: "languageChange", locale: this.getLanguagePreference() });

        try {
          const { history, hasMore } = await extractCommandHistory(this.workspacePath, 0);
          this.postMessage(ctx.panel, { type: "commandHistory", history, hasMore });
        } catch (err) {
          log("[MessageRouter] Error pre-loading command history:", err);
        }

        if (msg.type === "ready" && msg.savedSessionId) {
          ctx.session.setResumeSession(msg.savedSessionId);
          try {
            await this.historyManager.loadSessionHistory(msg.savedSessionId, ctx.panel);
            this.postMessage(ctx.panel, { type: "sessionStarted", sessionId: msg.savedSessionId });
          } catch (err) {
            log("[MessageRouter] Error auto-resuming session:", err);
            this.postMessage(ctx.panel, { type: "sessionStarted", sessionId: msg.savedSessionId });
          }
        } else {
          await ctx.session.initializeEarly();
        }
      },

      // Settings operations
      requestModels: async (msg, ctx) => {
        await this.settingsManager.sendAvailableModels(ctx.session, ctx.panel);
      },

      setModel: async (msg, ctx) => {
        if (msg.type !== "setModel") return;
        await this.settingsManager.handleSetModel(ctx.session, msg.model);
      },

      setMaxThinkingTokens: async (msg, ctx) => {
        if (msg.type !== "setMaxThinkingTokens") return;
        try {
          await this.settingsManager.handleSetMaxThinkingTokens(ctx.session, msg.tokens);
        } catch (err) {
          log("[MessageRouter] Error setting thinking tokens:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to save thinking tokens: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
          await this.settingsManager.sendCurrentSettings(ctx.panel, ctx.permissionHandler);
        }
      },

      setBudgetLimit: async (msg, ctx) => {
        if (msg.type !== "setBudgetLimit") return;
        try {
          await this.settingsManager.handleSetBudgetLimit(msg.budgetUsd);
        } catch (err) {
          log("[MessageRouter] Error setting budget limit:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to save budget limit: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
          await this.settingsManager.sendCurrentSettings(ctx.panel, ctx.permissionHandler);
        }
      },

      toggleBeta: async (msg) => {
        if (msg.type !== "toggleBeta") return;
        await this.settingsManager.handleToggleBeta(msg.beta, msg.enabled);
      },

      setPermissionMode: async (msg, ctx) => {
        if (msg.type !== "setPermissionMode") return;
        await this.settingsManager.handleSetPermissionMode(ctx.session, ctx.permissionHandler, msg.mode);
      },

      setDefaultPermissionMode: async (msg) => {
        if (msg.type !== "setDefaultPermissionMode") return;
        await this.settingsManager.handleSetDefaultPermissionMode(msg.mode);
      },

      // Rewind operations
      rewindToMessage: async (msg, ctx) => {
        if (msg.type !== "rewindToMessage") return;
        if (msg.option === "cancel") return;
        await ctx.session.rewindFiles(msg.userMessageId, msg.option, msg.promptContent);
      },

      requestRewindHistory: async (msg, ctx) => {
        const currentSessionId = ctx.session.currentSessionId;
        if (!currentSessionId) {
          this.postMessage(ctx.panel, { type: "rewindHistory", prompts: [] });
          return;
        }

        try {
          const conversationHead = ctx.session.conversationHead;
          const history = await this.historyManager.extractRewindHistory(currentSessionId, conversationHead);
          this.postMessage(ctx.panel, { type: "rewindHistory", prompts: history });
        } catch (err) {
          log("[MessageRouter] Error extracting rewind history:", err);
          this.postMessage(ctx.panel, { type: "rewindHistory", prompts: [] });
        }
      },

      // MCP and commands
      requestMcpStatus: async (msg, ctx) => {
        await this.settingsManager.sendMcpStatus(ctx.session, ctx.panel);
      },

      requestSupportedCommands: async (msg, ctx) => {
        await this.settingsManager.sendSupportedCommands(ctx.session, ctx.panel);
      },

      toggleMcpServer: async (msg, ctx) => {
        if (msg.type !== "toggleMcpServer") return;
        try {
          await this.settingsManager.setServerEnabled(msg.serverName, msg.enabled);
          ctx.session.setMcpServers(this.settingsManager.getEnabledMcpServers());
          ctx.session.restartForMcpChanges();
          this.settingsManager.sendMcpConfig(ctx.panel);
        } catch (err) {
          log("[MessageRouter] Error toggling MCP server:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to save MCP server setting: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
          this.settingsManager.sendMcpConfig(ctx.panel);
        }
      },

      // Plugin operations
      togglePlugin: async (msg, ctx) => {
        if (msg.type !== "togglePlugin") return;
        try {
          await this.settingsManager.setPluginEnabled(msg.pluginFullId, msg.enabled);
          ctx.session.setPlugins(this.settingsManager.getEnabledPlugins());
          ctx.session.restartForPluginChanges();
          this.settingsManager.sendPluginConfig(ctx.panel);
          const enabledPluginIds = this.settingsManager.getEnabledPluginIds();
          await this.workspaceManager.sendCustomSlashCommands(ctx.panel, enabledPluginIds);
          await this.workspaceManager.sendCustomAgents(ctx.panel, enabledPluginIds);
        } catch (err) {
          log("[MessageRouter] Error toggling plugin:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to save plugin setting: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
          this.settingsManager.sendPluginConfig(ctx.panel);
        }
      },

      requestPluginStatus: async (msg, ctx) => {
        this.settingsManager.sendPluginConfig(ctx.panel);
      },

      // VS Code operations
      openSettings: () => {
        vscode.commands.executeCommand("workbench.action.openSettings", "claude-unbound");
      },

      openSessionLog: async (msg, ctx) => {
        const sessionId = ctx.session.currentSessionId;
        if (sessionId) {
          const filePath = await getSessionFilePath(this.workspacePath, sessionId);
          const fileUri = vscode.Uri.file(filePath);
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc, { preview: false });
        } else {
          vscode.window.showInformationMessage(vscode.l10n.t("No active session to view"));
        }
      },

      openAgentLog: async (msg) => {
        if (msg.type !== "openAgentLog") return;
        try {
          const filePath = await getAgentFilePath(this.workspacePath, msg.agentId);
          const fileUri = vscode.Uri.file(filePath);
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err) {
          vscode.window.showWarningMessage(vscode.l10n.t("Agent log file not found: {0}", err instanceof Error ? err.message : "Unknown error"));
        }
      },

      openSessionPlan: async (msg, ctx) => {
        const sessionId = ctx.session.currentSessionId;
        if (!sessionId) {
          vscode.window.showInformationMessage(vscode.l10n.t("No active session"));
          return;
        }

        const metadata = await getSessionMetadata(this.workspacePath, sessionId);

        if (!metadata?.slug) {
          vscode.window.showInformationMessage(vscode.l10n.t("No plan exists for this session"));
          return;
        }

        const slug = metadata.slug;
        if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
          log("[MessageRouter] Invalid plan slug detected:", slug);
          vscode.window.showInformationMessage(vscode.l10n.t("No plan exists for this session"));
          return;
        }

        const planPath = path.join(os.homedir(), ".claude", "plans", `${slug}.md`);

        try {
          const content = await fs.readFile(planPath, "utf-8");
          this.postMessage(ctx.panel, { type: "showPlanContent", content, filePath: planPath });
        } catch (err) {
          log("[MessageRouter] Error reading plan file:", err);
          vscode.window.showInformationMessage(vscode.l10n.t("No plan exists for this session"));
        }
      },

      bindPlanToSession: async (msg, ctx) => {
        const sessionId = ctx.session.currentSessionId;
        if (!sessionId) {
          vscode.window.showInformationMessage(vscode.l10n.t("No active session"));
          return;
        }

        const fileResult = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { Markdown: ["md"] },
          title: vscode.l10n.t("Select Plan File to Inject"),
          defaultUri: vscode.Uri.file(this.workspacePath),
        });

        if (!fileResult || fileResult.length === 0) return;

        const selectedPath = fileResult[0].fsPath;
        const metadata = await getSessionMetadata(this.workspacePath, sessionId);
        const slug = metadata?.slug;

        try {
          const content = await fs.readFile(selectedPath, "utf-8");

          if (slug) {
            // Case 1: Slug exists - write file directly and send message
            if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
              log("[MessageRouter] Invalid plan slug detected:", slug);
              vscode.window.showWarningMessage(vscode.l10n.t("Invalid session slug"));
              return;
            }

            const slugPath = path.join(os.homedir(), ".claude", "plans", `${slug}.md`);

            let fileExists = false;
            try {
              await fs.access(slugPath);
              fileExists = true;
            } catch {
              fileExists = false;
            }

            if (fileExists) {
              const confirmation = await vscode.window.showWarningMessage(
                vscode.l10n.t("A plan file already exists for this session. Overwrite it?"),
                { modal: true },
                vscode.l10n.t("Overwrite"),
              );
              if (!confirmation) {
                return;
              }
            }

            await fs.mkdir(path.dirname(slugPath), { recursive: true });
            await fs.writeFile(slugPath, content);

            const config = vscode.workspace.getConfiguration("claude-unbound");
            const previousThinkingTokens = config.get<number | null>("maxThinkingTokens", null);
            await ctx.session.setMaxThinkingTokens(null);

            try {
              const notifyCorrelationId = `plan-notify-${Date.now()}`;
              this.postMessage(ctx.panel, {
                type: "userMessage",
                content: "[System] Updating plan file...",
                correlationId: notifyCorrelationId,
              });

              await ctx.session.sendMessage(
                `[System] The plan file for this session has been updated. Plan file path: ${slugPath}. Respond with "Got it. I'll use this plan as reference." - do not take any other action.`,
                undefined,
                notifyCorrelationId,
              );
            } finally {
              await ctx.session.setMaxThinkingTokens(previousThinkingTokens);
            }

            this.postMessage(ctx.panel, {
              type: "notification",
              message: vscode.l10n.t("Plan file updated: {0}", slugPath),
              notificationType: "info",
            });
            log("[MessageRouter] Injected plan from %s to %s", selectedPath, slugPath);
          } else {
            // Case 2: No slug - use Stop hook to write file after init message
            if (ctx.session.processing) {
              vscode.window.showWarningMessage(vscode.l10n.t("Cannot initialize plan mode while Claude is processing. Please wait and try again."));
              return;
            }

            const previousMode = ctx.permissionHandler.getPermissionMode();
            const config = vscode.workspace.getConfiguration("claude-unbound");
            const previousThinkingTokens = config.get<number | null>("maxThinkingTokens", null);

            ctx.session.setPendingPlanBind(content);

            await this.settingsManager.handleSetPermissionMode(ctx.session, ctx.permissionHandler, "plan");
            await ctx.session.setMaxThinkingTokens(null);
            await this.settingsManager.sendCurrentSettings(ctx.panel, ctx.permissionHandler);

            try {
              const triggerCorrelationId = `plan-init-${Date.now()}`;
              this.postMessage(ctx.panel, {
                type: "userMessage",
                content: "[System] Initializing plan mode for custom plan binding...",
                correlationId: triggerCorrelationId,
              });

              await ctx.session.sendMessage(
                `[System] Plan mode initialization for custom plan binding. Respond with "Got it. I'll use the imported plan as reference." - do not take any other action.`,
                undefined,
                triggerCorrelationId,
              );
            } finally {
              await this.settingsManager.handleSetPermissionMode(ctx.session, ctx.permissionHandler, previousMode);
              await ctx.session.setMaxThinkingTokens(previousThinkingTokens);
              await this.settingsManager.sendCurrentSettings(ctx.panel, ctx.permissionHandler);
            }

            this.postMessage(ctx.panel, {
              type: "notification",
              message: vscode.l10n.t("Plan file bound to session"),
              notificationType: "info",
            });
            log("[MessageRouter] Plan bind initiated via Stop hook from %s", selectedPath);
          }
        } catch (err) {
          log("[MessageRouter] Error injecting plan:", err);
          vscode.window.showErrorMessage(vscode.l10n.t("Failed to inject plan: {0}", err instanceof Error ? err.message : "Unknown error"));
        }
      },

      // Session management
      renameSession: async (msg, ctx) => {
        if (msg.type !== "renameSession") return;
        try {
          await renameSession(this.workspacePath, msg.sessionId, msg.newName);
          this.postMessage(ctx.panel, {
            type: "sessionRenamed",
            sessionId: msg.sessionId,
            newName: msg.newName,
          });
          this.storageManager.invalidateSessionsCache();
          const { sessions, hasMore, nextOffset } = await this.storageManager.getStoredSessions();
          this.postMessage(ctx.panel, {
            type: "storedSessions",
            sessions,
            hasMore,
            nextOffset,
            isFirstPage: true,
          });
        } catch (err) {
          log("[MessageRouter] Error renaming session:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to rename session: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
        }
      },

      deleteSession: async (msg, ctx) => {
        if (msg.type !== "deleteSession") return;
        try {
          const isActiveSession = ctx.session.currentSessionId === msg.sessionId;
          await deleteSession(this.workspacePath, msg.sessionId);

          if (isActiveSession) {
            ctx.session.reset();
            this.postMessage(ctx.panel, { type: "sessionCleared" });
          }

          this.postMessage(ctx.panel, { type: "sessionDeleted", sessionId: msg.sessionId });
          this.storageManager.invalidateSessionsCache();
          const { sessions, hasMore, nextOffset } = await this.storageManager.getStoredSessions();
          this.postMessage(ctx.panel, {
            type: "storedSessions",
            sessions,
            hasMore,
            nextOffset,
            isFirstPage: true,
          });
        } catch (err) {
          log("[MessageRouter] Error deleting session:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to delete session: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
        }
      },

      // History pagination
      requestMoreHistory: async (msg, ctx) => {
        if (msg.type !== "requestMoreHistory") return;
        await this.historyManager.loadMoreHistory(msg.sessionId, msg.offset, ctx.panel);
      },

      requestMoreSessions: async (msg, ctx) => {
        if (msg.type !== "requestMoreSessions") return;
        const { sessions, hasMore, nextOffset } = await this.storageManager.getStoredSessions(msg.offset);
        this.postMessage(ctx.panel, {
          type: "storedSessions",
          sessions,
          hasMore,
          nextOffset,
          isFirstPage: false,
        });
      },

      requestCommandHistory: async (msg, ctx) => {
        if (msg.type !== "requestCommandHistory") return;
        try {
          const offset = msg.offset ?? 0;
          const { history, hasMore } = await extractCommandHistory(this.workspacePath, offset);
          this.postMessage(ctx.panel, { type: "commandHistory", history, hasMore });
        } catch (err) {
          log("Failed to extract command history:", err);
          this.postMessage(ctx.panel, { type: "commandHistory", history: [], hasMore: false });
        }
      },

      // Workspace operations
      requestWorkspaceFiles: async (msg, ctx) => {
        await this.workspaceManager.sendWorkspaceFiles(ctx.panel);
      },

      openFile: async (msg, ctx) => {
        if (msg.type !== "openFile") return;
        await this.workspaceManager.handleOpenFile(ctx.panel, msg.filePath, msg.line);
      },

      requestCustomSlashCommands: async (msg, ctx) => {
        const enabledPluginIds = this.settingsManager.getEnabledPluginIds();
        await this.workspaceManager.sendCustomSlashCommands(ctx.panel, enabledPluginIds);
      },

      requestCustomAgents: async (msg, ctx) => {
        const enabledPluginIds = this.settingsManager.getEnabledPluginIds();
        await this.workspaceManager.sendCustomAgents(ctx.panel, enabledPluginIds);
      },

      setLanguagePreference: async (msg) => {
        if (msg.type !== "setLanguagePreference") return;
        await this.setLanguagePreference(msg.locale);
      },

      // Provider profiles
      requestProviderProfiles: (msg, ctx) => {
        this.settingsManager.sendProviderProfilesForPanel(ctx.panel, ctx.panelId);
      },

      createProviderProfile: async (msg, ctx) => {
        if (msg.type !== "createProviderProfile") return;
        try {
          await this.settingsManager.createProviderProfile(msg.profile);
          this.broadcastProviderProfilesToAllPanels();
        } catch (err) {
          log("[MessageRouter] Error creating provider profile:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to create provider profile: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
        }
      },

      updateProviderProfile: async (msg, ctx) => {
        if (msg.type !== "updateProviderProfile") return;
        try {
          const needsRestart = await this.settingsManager.updateProviderProfile(msg.originalName, msg.profile);
          this.broadcastProviderProfilesToAllPanels();

          if (needsRestart) {
            ctx.session.setProviderEnv(this.settingsManager.getActiveProviderEnvForPanel(ctx.panelId));
            ctx.session.restartForProviderChange();
          }
        } catch (err) {
          log("[MessageRouter] Error updating provider profile:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to update provider profile: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
        }
      },

      deleteProviderProfile: async (msg, ctx) => {
        if (msg.type !== "deleteProviderProfile") return;
        try {
          const currentProfile = this.settingsManager.getActiveProviderProfileForPanel(ctx.panelId);
          const needsRestart = currentProfile === msg.profileName;
          await this.settingsManager.deleteProviderProfile(msg.profileName);
          this.broadcastProviderProfilesToAllPanels();

          if (needsRestart) {
            ctx.session.setProviderEnv(undefined);
            ctx.session.restartForProviderChange();
          }
        } catch (err) {
          log("[MessageRouter] Error deleting provider profile:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to delete provider profile: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
        }
      },

      setActiveProviderProfile: async (msg, ctx) => {
        if (msg.type !== "setActiveProviderProfile") return;
        try {
          const needsRestart = this.settingsManager.setActiveProviderProfileForPanel(ctx.panelId, msg.profileName);
          this.settingsManager.sendProviderProfilesForPanel(ctx.panel, ctx.panelId);

          if (needsRestart) {
            ctx.session.setProviderEnv(this.settingsManager.getActiveProviderEnvForPanel(ctx.panelId));
            ctx.session.restartForProviderChange();
          }
        } catch (err) {
          log("[MessageRouter] Error setting active provider profile:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to set active provider profile: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
        }
      },

      setDefaultProviderProfile: async (msg, ctx) => {
        if (msg.type !== "setDefaultProviderProfile") return;
        try {
          await this.settingsManager.setDefaultProviderProfile(msg.profileName);
          this.broadcastProviderProfilesToAllPanels();
        } catch (err) {
          log("[MessageRouter] Error setting default provider profile:", err);
          this.postMessage(ctx.panel, {
            type: "notification",
            message: vscode.l10n.t("Failed to set default provider profile: {0}", err instanceof Error ? err.message : "Unknown error"),
            notificationType: "error",
          });
        }
      },
    };
  }

  private broadcastProviderProfilesToAllPanels(): void {
    for (const [panelId, instance] of this.getPanels()) {
      this.settingsManager.sendProviderProfilesForPanel(instance.panel, panelId);
    }
  }
}

function buildPlanImplementationMessage(planContent: string, transcriptPath: string | null): string {
  let message = `Implement the following plan:\n\n${planContent}`;

  if (transcriptPath) {
    message += `\n\nIf you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcriptPath}`;
  }

  return message;
}
