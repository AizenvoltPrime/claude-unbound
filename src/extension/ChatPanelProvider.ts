import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ClaudeSession } from "./ClaudeSession";
import { PermissionHandler } from "./PermissionHandler";
import { log } from "./logger";
import {
  listSessions,
  getSessionDir,
  ensureSessionDir,
  readSessionEntries,
  readSessionEntriesPaginated,
  renameSession,
  type StoredSession,
} from "./SessionStorage";
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage, McpServerConfig, ExtensionSettings, PermissionMode } from "../shared/types";

const SESSIONS_PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 30;

interface PanelInstance {
  panel: vscode.WebviewPanel;
  session: ClaudeSession;
  permissionHandler: PermissionHandler;
  disposables: vscode.Disposable[];
}

export class ChatPanelProvider {
  private panels: Map<string, PanelInstance> = new Map();
  private panelCounter: number = 0;
  private mcpServers: Record<string, McpServerConfig> = {};
  private workspacePath: string = "";
  private allSessionsCache: StoredSession[] | null = null;
  private mcpConfigLoaded: boolean = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    this.workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homeDir;
    // Pre-load MCP config but don't block constructor
    this.loadMcpConfig().catch((err) => {
      log("[ChatPanelProvider] Error pre-loading MCP config:", err);
    });
  }

  private async loadMcpConfig(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.mcpServers = {};
      this.mcpConfigLoaded = true;
      return;
    }

    const mcpConfigPath = path.join(workspaceFolder.uri.fsPath, ".mcp.json");
    try {
      const content = await fs.promises.readFile(mcpConfigPath, "utf-8");
      const config = JSON.parse(content);
      this.mcpServers = config.mcpServers || config;
    } catch {
      this.mcpServers = {};
    }
    this.mcpConfigLoaded = true;
  }

  private async getStoredSessions(
    offset: number = 0,
    limit: number = SESSIONS_PAGE_SIZE
  ): Promise<{ sessions: StoredSession[]; hasMore: boolean; nextOffset: number }> {
    log("[ChatPanelProvider] getStoredSessions called, workspacePath:", this.workspacePath, "offset:", offset);

    if (!this.allSessionsCache) {
      this.allSessionsCache = await listSessions(this.workspacePath);
      log("[ChatPanelProvider] Got", this.allSessionsCache.length, "sessions from listSessions");
    }

    const total = this.allSessionsCache.length;
    const sessions = this.allSessionsCache.slice(offset, offset + limit);
    const hasMore = offset + limit < total;
    const nextOffset = offset + sessions.length;

    log("[ChatPanelProvider] Returning", sessions.length, "sessions, hasMore:", hasMore);
    return { sessions, hasMore, nextOffset };
  }

  private invalidateSessionsCache(): void {
    this.allSessionsCache = null;
  }

  private findExistingPanelColumn(): vscode.ViewColumn | undefined {
    for (const group of vscode.window.tabGroups.all) {
      if (group.tabs.length === 0) continue;
      const allClaudePanels = group.tabs.every((tab) => {
        if (tab.input instanceof vscode.TabInputWebview) {
          return tab.input.viewType.includes("claude-unbound.chat");
        }
        return false;
      });
      if (allClaudePanels && group.viewColumn) {
        return group.viewColumn;
      }
    }
    return undefined;
  }

  private findUnusedColumn(): vscode.ViewColumn {
    const usedColumns = new Set<vscode.ViewColumn>();
    vscode.window.tabGroups.all.forEach((group) => {
      if (group.viewColumn !== undefined) {
        usedColumns.add(group.viewColumn);
      }
    });

    for (let col = vscode.ViewColumn.One; col <= vscode.ViewColumn.Nine; col++) {
      if (!usedColumns.has(col)) {
        return col;
      }
    }
    return vscode.ViewColumn.Beside;
  }

  async show(): Promise<void> {
    let targetColumn: vscode.ViewColumn;
    let startedInNewColumn = false;

    const existingColumn = this.findExistingPanelColumn();
    if (existingColumn) {
      targetColumn = existingColumn;
    } else {
      targetColumn = this.findUnusedColumn();
      startedInNewColumn = true;
    }

    const panelId = `panel-${++this.panelCounter}`;

    const panel = vscode.window.createWebviewPanel(
      "claude-unbound.chat",
      "Claude Unbound",
      { viewColumn: targetColumn, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
      }
    );

    panel.webview.html = this.getHtmlContent(panel.webview);
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "resources", "icon.png");

    // Lock the editor group if we started in a new column - this prevents files from opening here!
    if (startedInNewColumn) {
      await vscode.commands.executeCommand("workbench.action.lockEditorGroup");
    }

    const panelDisposables: vscode.Disposable[] = [];

    // Create a dedicated PermissionHandler for this panel
    // This ensures permission dialogs route to the correct panel's webview
    const permissionHandler = new PermissionHandler(this.extensionUri);
    permissionHandler.setPostMessage((msg) => this.postMessageToPanel(panel, msg));

    const session = await this.createSessionForPanel(panel, permissionHandler);

    this.panels.set(panelId, { panel, session, permissionHandler, disposables: panelDisposables });

    panelDisposables.push(
      panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) {
          this.invalidateSessionsCache();
          this.getStoredSessions()
            .then(({ sessions, hasMore, nextOffset }) => {
              this.postMessageToPanel(panel, { type: "storedSessions", sessions, hasMore, nextOffset, isFirstPage: true });
            })
            .catch((err) => {
              log("[ChatPanelProvider] Error refreshing sessions on visibility change:", err);
            });
        }
      })
    );

    panelDisposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
        this.handleWebviewMessage(message, panelId);
      })
    );

    panel.onDidDispose(() => {
      const instance = this.panels.get(panelId);
      if (instance) {
        instance.session.cancel();
        instance.permissionHandler.dispose();
        instance.disposables.forEach((d) => d.dispose());
        this.panels.delete(panelId);
      }
    });
  }

  private async createSessionForPanel(
    panel: vscode.WebviewPanel,
    permissionHandler: PermissionHandler
  ): Promise<ClaudeSession> {
    // Ensure MCP config is loaded before creating session
    if (!this.mcpConfigLoaded) {
      await this.loadMcpConfig();
    }

    // Ensure session directory exists before session can write to it
    await ensureSessionDir(this.workspacePath);

    const session = new ClaudeSession({
      cwd: this.workspacePath,
      permissionHandler: permissionHandler,
      onMessage: (message) => this.postMessageToPanel(panel, message),
      onSessionIdChange: (sessionId) => {
        this.postMessageToPanel(panel, { type: "sessionStarted", sessionId: sessionId || "" });
      },
      mcpServers: this.mcpServers,
    });

    return session;
  }

  private async handleWebviewMessage(message: WebviewToExtensionMessage, panelId: string): Promise<void> {
    const instance = this.panels.get(panelId);
    if (!instance) {
      log("[ChatPanelProvider] No panel instance found for", panelId);
      return;
    }

    const { panel, session } = instance;

    switch (message.type) {
      case "log":
        log("[Webview]", message.message);
        break;

      case "sendMessage":
        if (message.content.trim()) {
          this.postMessageToPanel(panel, {
            type: "userMessage",
            content: message.content,
          });
          session.sendMessage(message.content, message.agentId);
        }
        break;

      case "cancelSession":
        session.cancel();
        break;

      case "resumeSession":
        log("[ChatPanelProvider] resumeSession requested:", message.sessionId);
        if (message.sessionId) {
          session.setResumeSession(message.sessionId);
          log("[ChatPanelProvider] setResumeSession called");

          this.loadSessionHistory(message.sessionId, panel)
            .then(() => {
              log("[ChatPanelProvider] Session history loaded, sending sessionStarted");
              this.postMessageToPanel(panel, { type: "sessionStarted", sessionId: message.sessionId });
            })
            .catch((err) => {
              log("[ChatPanelProvider] Error loading session history:", err);
              this.postMessageToPanel(panel, { type: "sessionStarted", sessionId: message.sessionId });
            });
        }
        break;

      case "approveEdit":
        instance.permissionHandler.resolveApproval(message.approved, {
          neverAskAgain: message.neverAskAgain,
          customMessage: message.customMessage,
        });
        break;

      case "ready": {
        log("[ChatPanelProvider] Webview ready, fetching stored sessions...");
        this.getStoredSessions()
          .then(({ sessions, hasMore, nextOffset }) => {
            log("[ChatPanelProvider] Ready handler: got", sessions.length, "sessions, hasMore:", hasMore);
            this.postMessageToPanel(panel, { type: "storedSessions", sessions, hasMore, nextOffset, isFirstPage: true });
          })
          .catch((err) => {
            log("[ChatPanelProvider] Error fetching sessions:", err);
          });
        this.sendCurrentSettings(panel);
        this.sendAvailableModels(session, panel);
        break;
      }

      case "requestModels":
        this.sendAvailableModels(session, panel);
        break;

      case "setModel": {
        const config = vscode.workspace.getConfiguration("claude-unbound");
        await config.update("model", message.model, vscode.ConfigurationTarget.Workspace);
        await session.setModel(message.model);
        break;
      }

      case "setMaxThinkingTokens": {
        const config = vscode.workspace.getConfiguration("claude-unbound");
        await config.update("maxThinkingTokens", message.tokens, vscode.ConfigurationTarget.Workspace);
        await session.setMaxThinkingTokens(message.tokens);
        break;
      }

      case "setBudgetLimit": {
        const config = vscode.workspace.getConfiguration("claude-unbound");
        await config.update("maxBudgetUsd", message.budgetUsd, vscode.ConfigurationTarget.Workspace);
        break;
      }

      case "toggleBeta": {
        const config = vscode.workspace.getConfiguration("claude-unbound");
        const currentBetas = config.get<string[]>("betasEnabled", []);
        const newBetas = message.enabled ? [...currentBetas, message.beta] : currentBetas.filter((b) => b !== message.beta);
        await config.update("betasEnabled", newBetas, vscode.ConfigurationTarget.Workspace);
        break;
      }

      case "setPermissionMode": {
        const config = vscode.workspace.getConfiguration("claude-unbound");
        await config.update("permissionMode", message.mode, vscode.ConfigurationTarget.Workspace);
        await session.setPermissionMode(message.mode);
        break;
      }

      case "rewindToMessage":
        await session.rewindFiles(message.userMessageId);
        break;

      case "interrupt":
        await session.interrupt();
        break;

      case "requestMcpStatus":
        this.sendMcpStatus(session, panel);
        break;

      case "requestSupportedCommands":
        this.sendSupportedCommands(session, panel);
        break;

      case "openSettings":
        vscode.commands.executeCommand("workbench.action.openSettings", "claude-unbound");
        break;

      case "renameSession":
        try {
          await renameSession(this.workspacePath, message.sessionId, message.newName);
          this.postMessageToPanel(panel, { type: "sessionRenamed", sessionId: message.sessionId, newName: message.newName });
          this.invalidateSessionsCache();
          const { sessions, hasMore, nextOffset } = await this.getStoredSessions();
          this.postMessageToPanel(panel, { type: "storedSessions", sessions, hasMore, nextOffset, isFirstPage: true });
        } catch (err) {
          log("[ChatPanelProvider] Error renaming session:", err);
          this.postMessageToPanel(panel, {
            type: "notification",
            message: `Failed to rename session: ${err instanceof Error ? err.message : "Unknown error"}`,
            notificationType: "error",
          });
        }
        break;

      case "requestMoreHistory":
        log("[ChatPanelProvider] requestMoreHistory:", message.sessionId, "offset:", message.offset);
        await this.loadMoreHistory(message.sessionId, message.offset, panel);
        break;

      case "requestMoreSessions": {
        log("[ChatPanelProvider] requestMoreSessions, offset:", message.offset);
        const { sessions, hasMore, nextOffset } = await this.getStoredSessions(message.offset);
        this.postMessageToPanel(panel, { type: "storedSessions", sessions, hasMore, nextOffset, isFirstPage: false });
        break;
      }
    }
  }

  private sendCurrentSettings(panel: vscode.WebviewPanel): void {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    const settings: ExtensionSettings = {
      model: config.get<string>("model", ""),
      maxTurns: config.get<number>("maxTurns", 50),
      maxBudgetUsd: config.get<number | null>("maxBudgetUsd", null),
      maxThinkingTokens: config.get<number | null>("maxThinkingTokens", null),
      betasEnabled: config.get<string[]>("betasEnabled", []),
      permissionMode: config.get<PermissionMode>("permissionMode", "default"),
      enableFileCheckpointing: config.get<boolean>("enableFileCheckpointing", true),
      sandbox: config.get("sandbox", { enabled: false }),
    };
    this.postMessageToPanel(panel, { type: "settingsUpdate", settings });
  }

  private async sendAvailableModels(session: ClaudeSession, panel: vscode.WebviewPanel): Promise<void> {
    const models = await session.getSupportedModels();
    if (models && models.length > 0) {
      this.postMessageToPanel(panel, { type: "availableModels", models });
    }
  }

  private async sendMcpStatus(session: ClaudeSession, panel: vscode.WebviewPanel): Promise<void> {
    const status = await session.getMcpServerStatus();
    if (status) {
      this.postMessageToPanel(panel, { type: "mcpServerStatus", servers: status });
    }
  }

  private async sendSupportedCommands(session: ClaudeSession, panel: vscode.WebviewPanel): Promise<void> {
    const commands = await session.getSupportedCommands();
    if (commands) {
      this.postMessageToPanel(panel, { type: "supportedCommands", commands });
    }
  }

  private postMessageToPanel(panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage): void {
    panel.webview.postMessage(message);
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "index.css"));

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Claude Unbound</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private async loadSessionHistory(sessionId: string, panel: vscode.WebviewPanel): Promise<void> {
    log("[ChatPanelProvider] loadSessionHistory:", sessionId);
    const result = await readSessionEntriesPaginated(this.workspacePath, sessionId, 0, HISTORY_PAGE_SIZE);
    log("[ChatPanelProvider] Loaded", result.entries.length, "of", result.totalCount, "entries");

    const messages = this.convertEntriesToMessages(result.entries);

    for (const msg of messages) {
      if (msg.type === "user") {
        this.postMessageToPanel(panel, {
          type: "userReplay",
          content: msg.content,
          isSynthetic: false,
        });
      } else {
        this.postMessageToPanel(panel, {
          type: "assistantReplay",
          content: msg.content,
          thinking: msg.thinking,
        });
      }
    }

    if (result.hasMore) {
      this.postMessageToPanel(panel, {
        type: "historyChunk",
        messages: [],
        hasMore: result.hasMore,
        nextOffset: result.nextOffset,
      });
    }
    log("[ChatPanelProvider] Session history replay complete");
  }

  private async loadMoreHistory(sessionId: string, offset: number, panel: vscode.WebviewPanel): Promise<void> {
    log("[ChatPanelProvider] loadMoreHistory:", sessionId, "offset:", offset);
    const result = await readSessionEntriesPaginated(this.workspacePath, sessionId, offset, HISTORY_PAGE_SIZE);

    const messages = this.convertEntriesToMessages(result.entries);
    log("[ChatPanelProvider] Sending", messages.length, "more messages, hasMore:", result.hasMore);

    this.postMessageToPanel(panel, {
      type: "historyChunk",
      messages,
      hasMore: result.hasMore,
      nextOffset: result.nextOffset,
    });
  }

  private convertEntriesToMessages(
    entries: ReturnType<typeof readSessionEntries> extends Promise<infer T> ? T : never
  ): Array<{ type: "user" | "assistant"; content: string; thinking?: string }> {
    const messages: Array<{ type: "user" | "assistant"; content: string; thinking?: string }> = [];

    for (const entry of entries) {
      if (entry.type === "user" && entry.message && !entry.isMeta) {
        const content =
          typeof entry.message.content === "string"
            ? entry.message.content
            : Array.isArray(entry.message.content)
            ? entry.message.content
                .filter((b): b is { type: string; text: string } => b.type === "text" && typeof b.text === "string")
                .map((b) => b.text)
                .join("")
            : "";

        if (
          !content ||
          content.startsWith("<command-name>") ||
          content.startsWith("<local-command-") ||
          content.startsWith("Unknown slash command:") ||
          content.startsWith("Caveat:")
        ) {
          continue;
        }

        messages.push({ type: "user", content });
      } else if (entry.type === "assistant" && entry.message) {
        const msgContent = entry.message.content;
        let textContent = "";
        let thinkingContent = "";

        if (typeof msgContent === "string") {
          textContent = msgContent;
        } else if (Array.isArray(msgContent)) {
          textContent = msgContent
            .filter((b): b is { type: string; text?: string } => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text || "")
            .join("");
          thinkingContent = msgContent
            .filter((b): b is { type: string; thinking?: string } => b.type === "thinking" && typeof b.thinking === "string")
            .map((b) => b.thinking || "")
            .join("\n\n");
        }

        if ((!textContent && !thinkingContent) || textContent === "No response requested.") {
          continue;
        }

        messages.push({
          type: "assistant",
          content: textContent,
          thinking: thinkingContent || undefined,
        });
      }
    }

    return messages;
  }

  newSession(): void {
    for (const [, instance] of this.panels) {
      instance.session.reset();
      this.postMessageToPanel(instance.panel, { type: "processing", isProcessing: false });
      this.postMessageToPanel(instance.panel, { type: "sessionCleared" });
    }
  }

  cancelSession(): void {
    for (const [, instance] of this.panels) {
      instance.session.cancel();
    }
  }

  dispose(): void {
    for (const [, instance] of this.panels) {
      instance.session.cancel();
      instance.permissionHandler.dispose();
      instance.disposables.forEach((d) => d.dispose());
      instance.panel.dispose();
    }
    this.panels.clear();
  }
}
