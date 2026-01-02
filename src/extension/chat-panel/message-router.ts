import * as vscode from "vscode";
import type { ClaudeSession } from "../claude-session";
import type { PermissionHandler } from "../PermissionHandler";
import type { StorageManager } from "./storage-manager";
import type { HistoryManager } from "./history-manager";
import type { SettingsManager } from "./settings-manager";
import type { WorkspaceManager } from "./workspace-manager";
import { createQueuedMessage } from "./queue-manager";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  RewindOption,
} from "../../shared/types";
import type { PanelInstance } from "./types";
import type { IdeContextManager } from "./ide-context-manager";
import { getSessionFilePath, getAgentFilePath, renameSession, deleteSession, extractCommandHistory } from "../session";
import { log } from "../logger";

export interface MessageRouterConfig {
  workspacePath: string;
  postMessage: (panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage) => void;
  getPanels: () => Map<string, PanelInstance>;
  storageManager: StorageManager;
  historyManager: HistoryManager;
  settingsManager: SettingsManager;
  workspaceManager: WorkspaceManager;
}

interface HandlerContext {
  panel: vscode.WebviewPanel;
  session: ClaudeSession;
  permissionHandler: PermissionHandler;
  ideContextManager: IdeContextManager;
  panelId: string;
}

type MessageHandler = (
  message: WebviewToExtensionMessage,
  ctx: HandlerContext
) => Promise<void> | void;

export class MessageRouter {
  private readonly workspacePath: string;
  private readonly postMessage: MessageRouterConfig["postMessage"];
  private readonly getPanels: MessageRouterConfig["getPanels"];
  private readonly storageManager: StorageManager;
  private readonly historyManager: HistoryManager;
  private readonly settingsManager: SettingsManager;
  private readonly workspaceManager: WorkspaceManager;
  private readonly handlers: Record<string, MessageHandler>;

  constructor(config: MessageRouterConfig) {
    this.workspacePath = config.workspacePath;
    this.postMessage = config.postMessage;
    this.getPanels = config.getPanels;
    this.storageManager = config.storageManager;
    this.historyManager = config.historyManager;
    this.settingsManager = config.settingsManager;
    this.workspaceManager = config.workspaceManager;
    this.handlers = this.buildHandlerRegistry();
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
        if (msg.type !== "sendMessage" || !msg.content.trim()) return;

        const isCompactCommand = msg.content.trim().toLowerCase() === "/compact";
        const correlationId = `corr-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        if (!isCompactCommand) {
          this.postMessage(ctx.panel, { type: "userMessage", content: msg.content, correlationId });
        }

        this.storageManager.broadcastCommandHistoryEntry(msg.content.trim());

        const content = msg.includeIdeContext
          ? ctx.ideContextManager.buildContentBlocks(msg.content)
          : msg.content;

        await ctx.session.sendMessage(content, msg.agentId, correlationId);
      },

      cancelSession: (_msg, ctx) => {
        ctx.session.cancel();
      },

      queueMessage: async (msg, ctx) => {
        if (msg.type !== "queueMessage" || !msg.content.trim()) return;

        const queuedMessage = createQueuedMessage(msg.content);
        const injected = ctx.session.queueInput(msg.content, queuedMessage.id);

        if (injected) {
          this.postMessage(ctx.panel, { type: "messageQueued", message: queuedMessage });
          this.storageManager.broadcastCommandHistoryEntry(msg.content.trim());
        } else {
          this.postMessage(ctx.panel, {
            type: "notification",
            message: "Cannot send mid-stream message: no active streaming session",
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

        this.settingsManager.sendCurrentSettings(ctx.panel, ctx.permissionHandler);
        this.settingsManager.sendAvailableModels(ctx.session, ctx.panel);
        this.settingsManager.sendMcpConfig(ctx.panel);

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
        await this.settingsManager.handleSetMaxThinkingTokens(ctx.session, msg.tokens);
      },

      setBudgetLimit: async (msg) => {
        if (msg.type !== "setBudgetLimit") return;
        await this.settingsManager.handleSetBudgetLimit(msg.budgetUsd);
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

        const option = msg.option as RewindOption;
        log("[MessageRouter] Rewind requested:", { option, userMessageId: msg.userMessageId });

        if (option === "cancel") return;

        await ctx.session.rewindFiles(msg.userMessageId, option);
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
        await this.settingsManager.setServerEnabled(msg.serverName, msg.enabled);
        ctx.session.setMcpServers(this.settingsManager.getEnabledMcpServers());
        ctx.session.restartForMcpChanges();
        this.settingsManager.sendMcpConfig(ctx.panel);
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
          vscode.window.showInformationMessage("No active session to view");
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
          vscode.window.showWarningMessage(
            `Agent log file not found: ${err instanceof Error ? err.message : "Unknown error"}`
          );
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
            message: `Failed to rename session: ${err instanceof Error ? err.message : "Unknown error"}`,
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
            message: `Failed to delete session: ${err instanceof Error ? err.message : "Unknown error"}`,
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
        await this.workspaceManager.sendCustomSlashCommands(ctx.panel);
      },

      requestCustomAgents: async (msg, ctx) => {
        await this.workspaceManager.sendCustomAgents(ctx.panel);
      },
    };
  }

}
