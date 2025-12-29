import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ClaudeSession } from "./ClaudeSession";
import { PermissionHandler } from "./PermissionHandler";
import { SlashCommandService } from "./SlashCommandService";
import { extractSlashCommandDisplay } from "../shared/utils";
import { BUILTIN_SLASH_COMMANDS } from "../shared/slashCommands";
import { log } from "./logger";
import { listWorkspaceFiles } from "./ripgrep";
import {
  listSessions,
  getSessionDir,
  getSessionDirSync,
  getSessionFilePath,
  getAgentFilePath,
  getSessionMetadata,
  ensureSessionDir,
  readSessionEntries,
  readActiveBranchEntries,
  readSessionEntriesPaginated,
  readAgentData,
  renameSession,
  deleteSession,
  extractSessionStats,
  extractCommandHistory,
  findUserTextBlock,
  type StoredSession,
  type AgentData,
  type JsonlContentBlock,
  type ClaudeSessionEntry,
} from "./session";
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage, McpServerConfig, ExtensionSettings, PermissionMode, HistoryMessage, HistoryToolCall, RewindOption, RewindHistoryItem } from "../shared/types";

const SESSIONS_PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 30;
const TOOL_RESULT_MAX_LENGTH = 500;

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
  private sessionWatcher: vscode.FileSystemWatcher | null = null;
  private slashCommandService: SlashCommandService;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    this.workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homeDir;
    this.slashCommandService = new SlashCommandService(this.workspacePath);
    this.setupSessionWatcher();
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
    if (!this.allSessionsCache) {
      this.allSessionsCache = await listSessions(this.workspacePath);
    }

    const total = this.allSessionsCache.length;
    const sessions = this.allSessionsCache.slice(offset, offset + limit);
    const hasMore = offset + limit < total;
    const nextOffset = offset + sessions.length;

    return { sessions, hasMore, nextOffset };
  }

  private invalidateSessionsCache(): void {
    this.allSessionsCache = null;
  }

  private setupSessionWatcher(): void {
    if (this.sessionWatcher) return;

    const sessionDir = getSessionDirSync(this.workspacePath);

    if (!fs.existsSync(sessionDir)) {
      return;
    }

    const pattern = new vscode.RelativePattern(vscode.Uri.file(sessionDir), "*.jsonl");

    this.sessionWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.sessionWatcher.onDidCreate((uri) => this.handleSessionFileCreated(uri));
    this.sessionWatcher.onDidDelete((uri) => this.handleSessionFileDeleted(uri));
  }

  private async handleSessionFileCreated(uri: vscode.Uri): Promise<void> {
    const filename = path.basename(uri.fsPath);
    if (!filename.endsWith(".jsonl") || filename.startsWith("agent-")) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));

    const sessionId = filename.replace(".jsonl", "");
    const metadata = await getSessionMetadata(this.workspacePath, sessionId);

    if (!metadata) {
      return;
    }

    if (!this.allSessionsCache) {
      this.allSessionsCache = await listSessions(this.workspacePath);
    } else {
      const existingIndex = this.allSessionsCache.findIndex((s) => s.id === sessionId);
      if (existingIndex >= 0) {
        this.allSessionsCache[existingIndex] = metadata;
      } else {
        this.allSessionsCache.push(metadata);
      }
      this.allSessionsCache.sort((a, b) => b.timestamp - a.timestamp);
    }

    this.pushSessionsToAllPanels();
  }

  private handleSessionFileDeleted(uri: vscode.Uri): void {
    const filename = path.basename(uri.fsPath);
    if (!filename.endsWith(".jsonl") || filename.startsWith("agent-")) {
      return;
    }

    const sessionId = filename.replace(".jsonl", "");

    if (this.allSessionsCache) {
      this.allSessionsCache = this.allSessionsCache.filter((s) => s.id !== sessionId);
    }

    this.pushSessionsToAllPanels();
  }

  private pushSessionsToAllPanels(): void {
    if (!this.allSessionsCache) return;

    const sessions = this.allSessionsCache.slice(0, SESSIONS_PAGE_SIZE);
    const hasMore = this.allSessionsCache.length > SESSIONS_PAGE_SIZE;
    const nextOffset = sessions.length;

    for (const [, instance] of this.panels) {
      this.postMessageToPanel(instance.panel, {
        type: "storedSessions",
        sessions,
        hasMore,
        nextOffset,
        isFirstPage: true,
      });
    }
  }

  private broadcastCommandHistoryEntry(entry: string): void {
    for (const [, instance] of this.panels) {
      this.postMessageToPanel(instance.panel, {
        type: "commandHistoryPush",
        entry,
      });
    }
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
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
          vscode.Uri.joinPath(this.extensionUri, "resources"),
        ],
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
          this.postMessageToPanel(panel, { type: "panelFocused" });
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

    panelDisposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('claude-unbound')) {
          this.sendCurrentSettings(panel, permissionHandler);
        }
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
        this.setupSessionWatcher();
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

    const { panel, session, permissionHandler } = instance;

    switch (message.type) {
      case "log":
        log("[Webview]", message.message);
        break;

      case "sendMessage":
        if (message.content.trim()) {
          // Don't display /compact command in chat - it will be replaced by CompactMarker
          const isCompactCommand = message.content.trim().toLowerCase() === '/compact';
          if (!isCompactCommand) {
            this.postMessageToPanel(panel, {
              type: "userMessage",
              content: message.content,
            });
          }
          // Send raw message to SDK - SDK handles slash command expansion
          // This matches CLI behavior: SDK creates XML wrapper + isMeta message
          session.sendMessage(message.content, message.agentId);
          this.broadcastCommandHistoryEntry(message.content.trim());
        }
        break;

      case "cancelSession":
        session.cancel();
        break;

      case "resumeSession":
        if (message.sessionId) {
          session.setResumeSession(message.sessionId);

          this.loadSessionHistory(message.sessionId, panel)
            .then(() => {
              this.postMessageToPanel(panel, { type: "sessionStarted", sessionId: message.sessionId });
            })
            .catch((err) => {
              log("[ChatPanelProvider] Error loading session history:", err);
              this.postMessageToPanel(panel, { type: "sessionStarted", sessionId: message.sessionId });
            });
        }
        break;

      case "approveEdit":
        instance.permissionHandler.resolveApproval(message.toolUseId, message.approved, {
          customMessage: message.customMessage,
        });
        break;

      case "ready": {
        this.getStoredSessions()
          .then(({ sessions, hasMore, nextOffset }) => {
            this.postMessageToPanel(panel, { type: "storedSessions", sessions, hasMore, nextOffset, isFirstPage: true });
          })
          .catch((err) => {
            log("[ChatPanelProvider] Error fetching sessions:", err);
          });
        this.sendCurrentSettings(panel, permissionHandler);
        this.sendAvailableModels(session, panel);
        extractCommandHistory(this.workspacePath, 0)
          .then(({ history, hasMore }) => {
            this.postMessageToPanel(panel, { type: "commandHistory", history, hasMore });
          })
          .catch((err) => {
            log("[ChatPanelProvider] Error pre-loading command history:", err);
          });
        break;
      }

      case "requestModels":
        this.sendAvailableModels(session, panel);
        break;

      case "setModel": {
        const config = vscode.workspace.getConfiguration("claude-unbound");
        await config.update("model", message.model, vscode.ConfigurationTarget.Global);
        await session.setModel(message.model);
        break;
      }

      case "setMaxThinkingTokens": {
        const config = vscode.workspace.getConfiguration("claude-unbound");
        await config.update("maxThinkingTokens", message.tokens, vscode.ConfigurationTarget.Global);
        await session.setMaxThinkingTokens(message.tokens);
        break;
      }

      case "setBudgetLimit": {
        const config = vscode.workspace.getConfiguration("claude-unbound");
        await config.update("maxBudgetUsd", message.budgetUsd, vscode.ConfigurationTarget.Global);
        break;
      }

      case "toggleBeta": {
        const config = vscode.workspace.getConfiguration("claude-unbound");
        const currentBetas = config.get<string[]>("betasEnabled", []);
        const newBetas = message.enabled ? [...currentBetas, message.beta] : currentBetas.filter((b) => b !== message.beta);
        await config.update("betasEnabled", newBetas, vscode.ConfigurationTarget.Global);
        break;
      }

      case "setPermissionMode": {
        // Per-panel permission mode - don't persist to VS Code config
        permissionHandler.setPermissionMode(message.mode);
        await session.setPermissionMode(message.mode);
        break;
      }

      case "setDefaultPermissionMode": {
        // Global default - persists to VS Code config (affects new panels)
        const config = vscode.workspace.getConfiguration("claude-unbound");
        await config.update("permissionMode", message.mode, vscode.ConfigurationTarget.Global);
        break;
      }

      case "rewindToMessage": {
        const option = message.option as RewindOption;
        log('[ChatPanelProvider] Rewind requested:', { option, userMessageId: message.userMessageId });

        // 'cancel' is handled in the webview - shouldn't reach here, but guard anyway
        if (option === 'cancel') break;

        // All other options are handled by ClaudeSession.rewindFiles():
        // - 'code-and-conversation': Restore files + fork conversation
        // - 'conversation-only': Fork conversation only (no file restore)
        // - 'code-only': Restore files only (conversation stays linear)
        await session.rewindFiles(message.userMessageId, option);
        break;
      }

      case "requestRewindHistory": {
        const currentSessionId = session.currentSessionId;
        if (!currentSessionId) {
          this.postMessageToPanel(panel, { type: 'rewindHistory', prompts: [] });
          break;
        }

        try {
          // Pass conversation head to filter out rewound prompts
          const conversationHead = session.conversationHead;
          const history = await this.extractRewindHistory(currentSessionId, conversationHead);
          this.postMessageToPanel(panel, { type: 'rewindHistory', prompts: history });
        } catch (err) {
          log('[ChatPanelProvider] Error extracting rewind history:', err);
          this.postMessageToPanel(panel, { type: 'rewindHistory', prompts: [] });
        }
        break;
      }

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

      case "openSessionLog": {
        const sessionId = session.currentSessionId;
        if (sessionId) {
          const filePath = await getSessionFilePath(this.workspacePath, sessionId);
          const fileUri = vscode.Uri.file(filePath);
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc, { preview: false });
        } else {
          vscode.window.showInformationMessage("No active session to view");
        }
        break;
      }

      case "openAgentLog": {
        try {
          const filePath = await getAgentFilePath(this.workspacePath, message.agentId);
          const fileUri = vscode.Uri.file(filePath);
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err) {
          vscode.window.showWarningMessage(
            `Agent log file not found: ${err instanceof Error ? err.message : "Unknown error"}`
          );
        }
        break;
      }

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

      case "deleteSession": {
        try {
          const isActiveSession = session.currentSessionId === message.sessionId;
          await deleteSession(this.workspacePath, message.sessionId);

          if (isActiveSession) {
            session.reset();
            this.postMessageToPanel(panel, { type: "sessionCleared" });
          }

          this.postMessageToPanel(panel, { type: "sessionDeleted", sessionId: message.sessionId });
          this.invalidateSessionsCache();
          const { sessions, hasMore, nextOffset } = await this.getStoredSessions();
          this.postMessageToPanel(panel, { type: "storedSessions", sessions, hasMore, nextOffset, isFirstPage: true });
        } catch (err) {
          log("[ChatPanelProvider] Error deleting session:", err);
          this.postMessageToPanel(panel, {
            type: "notification",
            message: `Failed to delete session: ${err instanceof Error ? err.message : "Unknown error"}`,
            notificationType: "error",
          });
        }
        break;
      }

      case "requestMoreHistory":
        await this.loadMoreHistory(message.sessionId, message.offset, panel);
        break;

      case "requestMoreSessions": {
        const { sessions, hasMore, nextOffset } = await this.getStoredSessions(message.offset);
        this.postMessageToPanel(panel, { type: "storedSessions", sessions, hasMore, nextOffset, isFirstPage: false });
        break;
      }

      case "requestCommandHistory": {
        try {
          const offset = message.offset ?? 0;
          const { history, hasMore } = await extractCommandHistory(this.workspacePath, offset);
          this.postMessageToPanel(panel, { type: "commandHistory", history, hasMore });
        } catch (err) {
          log("Failed to extract command history:", err);
          this.postMessageToPanel(panel, { type: "commandHistory", history: [], hasMore: false });
        }
        break;
      }

      case "requestWorkspaceFiles": {
        try {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            this.postMessageToPanel(panel, { type: "workspaceFiles", files: [] });
            break;
          }

          const files = await listWorkspaceFiles(workspaceFolder.uri.fsPath);
          this.postMessageToPanel(panel, { type: "workspaceFiles", files });
        } catch (err) {
          log("[ChatPanelProvider] Error fetching workspace files:", err);
          this.postMessageToPanel(panel, { type: "workspaceFiles", files: [] });
        }
        break;
      }

      case "openFile": {
        try {
          let filePath = message.filePath;
          if (filePath.startsWith('./') && this.workspacePath) {
            const resolvedPath = path.resolve(this.workspacePath, filePath.slice(2));
            if (!resolvedPath.startsWith(this.workspacePath)) {
              throw new Error('Path traversal attempt detected');
            }
            filePath = resolvedPath;
          }
          const uri = vscode.Uri.file(filePath);
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc);
          if (message.line && message.line > 0) {
            const position = new vscode.Position(message.line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
          }
        } catch (err) {
          log("[ChatPanelProvider] Error opening file:", err);
          vscode.window.showErrorMessage(`Could not open file: ${message.filePath}`);
        }
        break;
      }

      case "requestCustomSlashCommands": {
        try {
          const customCommands = await this.slashCommandService.getCommands();
          const allCommands = [...BUILTIN_SLASH_COMMANDS, ...customCommands];
          this.postMessageToPanel(panel, { type: "customSlashCommands", commands: allCommands });
        } catch (err) {
          log("[ChatPanelProvider] Error fetching custom slash commands:", err);
          this.postMessageToPanel(panel, { type: "customSlashCommands", commands: BUILTIN_SLASH_COMMANDS });
        }
        break;
      }

    }
  }

  private sendCurrentSettings(panel: vscode.WebviewPanel, permissionHandler: PermissionHandler): void {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    // permissionMode = per-panel mode (from handler)
    // defaultPermissionMode = global default (from VS Code config)
    const settings: ExtensionSettings = {
      model: config.get<string>("model", ""),
      maxTurns: config.get<number>("maxTurns", 50),
      maxBudgetUsd: config.get<number | null>("maxBudgetUsd", null),
      maxThinkingTokens: config.get<number | null>("maxThinkingTokens", null),
      betasEnabled: config.get<string[]>("betasEnabled", []),
      permissionMode: permissionHandler.getPermissionMode(),
      defaultPermissionMode: config.get<PermissionMode>("permissionMode", "default"),
      enableFileCheckpointing: config.get<boolean>("enableFileCheckpointing", true),
      sandbox: config.get<{ enabled: boolean }>("sandbox", { enabled: false }),
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
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "resources", "icon.png"));

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; font-src ${webview.cspSource}; img-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Claude Unbound</title>
</head>
<body>
  <div id="app" data-logo-uri="${logoUri}"></div>
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

  private async extractRewindHistory(sessionId: string, conversationHead?: string | null): Promise<RewindHistoryItem[]> {
    // Use active branch entries to exclude rewound/orphaned messages
    // If conversationHead is provided, use it as the leaf for branch calculation
    const entries = await readActiveBranchEntries(this.workspacePath, sessionId, conversationHead ?? undefined);
    const history: RewindHistoryItem[] = [];

    for (const entry of entries) {
      if (entry.type !== 'user' || !entry.uuid || entry.isMeta || entry.isCompactSummary) continue;

      const msgContent = entry.message?.content;
      let content = '';

      if (typeof msgContent === 'string') {
        content = msgContent;
      } else if (Array.isArray(msgContent)) {
        const textBlock = findUserTextBlock(msgContent as JsonlContentBlock[]);
        content = textBlock?.text ?? '';
      }

      if (!content || content.startsWith('<command-') || content.startsWith('<local-command-')) {
        continue;
      }

      if (entry.isInterrupt || content === '[Request interrupted by user]') {
        continue;
      }

      history.push({
        messageId: entry.uuid,
        content: content.slice(0, 200),
        timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
        filesAffected: 0,
      });
    }

    return history.reverse();
  }

  private async loadSessionHistory(sessionId: string, panel: vscode.WebviewPanel): Promise<void> {
    this.postMessageToPanel(panel, { type: "sessionCleared" });

    log(`[ChatPanelProvider] loadSessionHistory: sessionId=${sessionId}`);
    const result = await readSessionEntriesPaginated(this.workspacePath, sessionId, 0, HISTORY_PAGE_SIZE);
    log(`[ChatPanelProvider] readSessionEntriesPaginated result: entries=${result.entries.length}, hasCompactInfo=${!!result.compactInfo}`);

    // If there was a compact, send the boundary marker first
    // (compact detection and filtering is now done in readSessionEntriesPaginated)
    if (result.compactInfo) {
      log(`[ChatPanelProvider] sending compactBoundary: trigger=${result.compactInfo.trigger}, hasSummary=${!!result.compactInfo.summary}, summaryLength=${result.compactInfo.summary?.length ?? 0}`);
      this.postMessageToPanel(panel, {
        type: "compactBoundary",
        preTokens: result.compactInfo.preTokens,
        trigger: result.compactInfo.trigger,
        summary: result.compactInfo.summary,
        timestamp: result.compactInfo.timestamp,
        isHistorical: true,
      });
    } else {
      log(`[ChatPanelProvider] no compactInfo found`);
    }

    const messages = await this.convertEntriesToMessages(result.entries);

    for (const msg of messages) {
      if (msg.type === "user") {
        this.postMessageToPanel(panel, {
          type: "userReplay",
          content: msg.content,
          isSynthetic: false,
          sdkMessageId: msg.sdkMessageId,
        });
      } else if (msg.type === "error") {
        this.postMessageToPanel(panel, {
          type: "errorReplay",
          content: msg.content,
        });
      } else {
        this.postMessageToPanel(panel, {
          type: "assistantReplay",
          content: msg.content,
          thinking: msg.thinking,
          tools: msg.tools,
        });
      }
    }

    try {
      const stats = await extractSessionStats(this.workspacePath, sessionId);
      if (stats) {
        // Send all stats from history. Context stats are now normalized:
        // - extractSessionStats applies divide-by-2 for messages with tool calls
        // - This matches the same logic used for live SDK stats
        this.postMessageToPanel(panel, {
          type: "done",
          data: {
            type: "result",
            session_id: sessionId,
            is_done: true,
            total_input_tokens: stats.totalInputTokens,
            total_output_tokens: stats.totalOutputTokens,
            cache_creation_tokens: stats.cacheCreationTokens,
            cache_read_tokens: stats.cacheReadTokens,
            num_turns: stats.numTurns,
            context_window_size: stats.contextWindowSize,
          },
        });
      }
    } catch {
      // Stats extraction failed - session will load without stats
    }

    // Notify webview if there are more entries to load
    // (readSessionEntriesPaginated already filters to post-compact entries)
    if (result.hasMore) {
      this.postMessageToPanel(panel, {
        type: "historyChunk",
        messages: [],
        hasMore: true,
        nextOffset: result.nextOffset,
      });
    }
  }

  private async loadMoreHistory(sessionId: string, offset: number, panel: vscode.WebviewPanel): Promise<void> {
    // Note: readSessionEntriesPaginated already filters to only entries after the last compact
    // and includes compactInfo in the result. For loadMore, we don't need to send compactInfo
    // again since it was sent in the initial load.
    const result = await readSessionEntriesPaginated(this.workspacePath, sessionId, offset, HISTORY_PAGE_SIZE);

    const messages = await this.convertEntriesToMessages(result.entries);

    this.postMessageToPanel(panel, {
      type: "historyChunk",
      messages,
      hasMore: result.hasMore,
      nextOffset: result.nextOffset,
    });
  }

  private async convertEntriesToMessages(
    entries: ReturnType<typeof readSessionEntries> extends Promise<infer T> ? T : never
  ): Promise<HistoryMessage[]> {
    const messages: HistoryMessage[] = [];
    // Map tool_use_id -> tool result (from subsequent user messages)
    const toolResults = new Map<string, string>();
    // Map tool_use_id -> agentId (for loading agent tool calls)
    const taskToolAgents = new Map<string, string>();

    // First pass: collect all tool results from user messages
    for (const entry of entries) {
      if (entry.type === "user" && entry.message && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content as JsonlContentBlock[]) {
          if (block.type === "tool_result") {
            // Check if this is a Task tool result with rich metadata
            if (entry.toolUseResult?.totalDurationMs !== undefined) {
              // Store the full toolUseResult as JSON for Task tools
              toolResults.set(block.tool_use_id, JSON.stringify(entry.toolUseResult));
              // Track agentId for loading agent tool calls
              if (entry.toolUseResult.agentId) {
                taskToolAgents.set(block.tool_use_id, entry.toolUseResult.agentId);
              }
            } else {
              // Truncate long tool results for display
              const result = typeof block.content === 'string'
                ? (block.content.length > TOOL_RESULT_MAX_LENGTH
                    ? block.content.slice(0, TOOL_RESULT_MAX_LENGTH) + "... (truncated)"
                    : block.content)
                : JSON.stringify(block.content);
              toolResults.set(block.tool_use_id, result);
            }
          }
        }
      }
    }

    // Load agent data (tool calls + model) for all Task tools in parallel
    const agentDataMap = new Map<string, AgentData>();
    await Promise.all(
      Array.from(taskToolAgents.entries()).map(async ([toolUseId, agentId]) => {
        const agentData = await readAgentData(this.workspacePath, agentId);
        agentDataMap.set(toolUseId, agentData);
      })
    );

    // Second pass: build messages with tool calls
    for (const entry of entries) {
      // Skip meta entries, compact summaries, and transcript-only entries
      if (entry.type === "user" && entry.message && !entry.isMeta && !entry.isCompactSummary && !entry.isVisibleInTranscriptOnly) {
        const msgContent = entry.message.content;
        let content = "";

        if (typeof msgContent === "string") {
          content = msgContent;
        } else if (Array.isArray(msgContent)) {
          const textBlock = findUserTextBlock(msgContent as JsonlContentBlock[]);
          content = textBlock?.text ?? "";
        }

        // Skip empty, system messages, and /compact command (replaced by CompactMarker)
        if (
          !content ||
          content.startsWith("Unknown slash command:") ||
          content.startsWith("Caveat:") ||
          content.toLowerCase() === '/compact'
        ) {
          continue;
        }

        // Get SDK message ID for rewind correlation
        const sdkMessageId = entry.uuid;

        // Extract display format from slash command XML wrappers
        if (content.startsWith("<command-message>") || content.startsWith("<command-name>")) {
          const displayContent = extractSlashCommandDisplay(content);
          // Skip /compact command - it's replaced by CompactMarker
          if (displayContent && displayContent.toLowerCase() !== '/compact') {
            messages.push({ type: "user", content: displayContent, sdkMessageId });
          }
          continue;
        }

        // Skip local command wrappers (CLI internal)
        if (content.startsWith("<local-command-")) {
          continue;
        }

        // Convert interrupt markers to error messages
        if (entry.isInterrupt || content === "[Request interrupted by user]") {
          messages.push({ type: "error", content: "Claude Code process aborted by user" });
          continue;
        }

        messages.push({ type: "user", content, sdkMessageId });
      } else if (entry.type === "assistant" && entry.message) {
        const msgContent = entry.message.content;

        let textContent = "";
        let thinkingContent = "";
        const tools: HistoryToolCall[] = [];

        if (typeof msgContent === "string") {
          textContent = msgContent;
        } else if (Array.isArray(msgContent)) {
          const blocks = msgContent as JsonlContentBlock[];

          // Extract text content
          textContent = blocks
            .filter((b): b is { type: 'text'; text: string } => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text)
            .join("");

          // Extract thinking content
          thinkingContent = blocks
            .filter((b): b is { type: 'thinking'; thinking: string } => b.type === "thinking" && typeof b.thinking === "string")
            .map((b) => b.thinking)
            .join("\n\n");

          // Extract tool_use blocks
          for (const block of blocks) {
            if (block.type === "tool_use") {
              const tool: HistoryToolCall = {
                id: block.id,
                name: block.name,
                input: block.input,
              };
              // Attach result if we have it
              const result = toolResults.get(block.id);
              if (result) {
                tool.result = result;
              }
              // For Task tools, attach nested agent data (tool calls + model + agentId)
              const agentId = taskToolAgents.get(block.id);
              if (agentId) {
                tool.sdkAgentId = agentId;
                const agentData = agentDataMap.get(block.id);
                if (agentData) {
                  if (agentData.toolCalls.length > 0) {
                    tool.agentToolCalls = agentData.toolCalls;
                  }
                  if (agentData.model) {
                    tool.agentModel = agentData.model;
                  }
                }
              }
              tools.push(tool);
            }
          }
        }

        // Skip empty messages (unless they have tool calls)
        if (!textContent && !thinkingContent && tools.length === 0) {
          continue;
        }
        if (textContent === "No response requested." && tools.length === 0) {
          continue;
        }

        const msg: HistoryMessage = {
          type: "assistant",
          content: textContent,
          thinking: thinkingContent || undefined,
          tools: tools.length > 0 ? tools : undefined,
        };
        messages.push(msg);
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
    this.sessionWatcher?.dispose();
    this.slashCommandService.dispose();
    for (const [, instance] of this.panels) {
      instance.session.cancel();
      instance.permissionHandler.dispose();
      instance.disposables.forEach((d) => d.dispose());
      instance.panel.dispose();
    }
    this.panels.clear();
  }
}
