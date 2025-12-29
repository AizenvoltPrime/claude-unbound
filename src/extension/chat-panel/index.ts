import * as vscode from "vscode";
import { PanelManager } from "./panel-manager";
import { StorageManager } from "./storage-manager";
import { HistoryManager } from "./history-manager";
import { SettingsManager } from "./settings-manager";
import { WorkspaceManager } from "./workspace-manager";
import { SessionManager } from "./session-manager";
import { MessageRouter } from "./message-router";
import { log } from "../logger";

export class ChatPanelProvider {
  private readonly panelManager: PanelManager;
  private readonly storageManager: StorageManager;
  private readonly historyManager: HistoryManager;
  private readonly settingsManager: SettingsManager;
  private readonly workspaceManager: WorkspaceManager;
  private readonly sessionManager: SessionManager;
  private readonly messageRouter: MessageRouter;
  private readonly workspacePath: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    _context: vscode.ExtensionContext
  ) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    this.workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homeDir;

    const postMessage = (panel: vscode.WebviewPanel, message: unknown) => {
      this.panelManager.postMessageToPanel(panel, message as Parameters<typeof this.panelManager.postMessageToPanel>[1]);
    };

    this.settingsManager = new SettingsManager({
      postMessage,
    });

    this.storageManager = new StorageManager({
      workspacePath: this.workspacePath,
      postMessage,
      getPanels: () => this.panelManager.getPanels(),
    });

    this.historyManager = new HistoryManager({
      workspacePath: this.workspacePath,
      postMessage,
    });

    this.workspaceManager = new WorkspaceManager({
      workspacePath: this.workspacePath,
      postMessage,
    });

    this.sessionManager = new SessionManager({
      workspacePath: this.workspacePath,
      getMcpServers: () => this.settingsManager.getMcpServers(),
      getMcpConfigLoaded: () => this.settingsManager.getMcpConfigLoaded(),
      loadMcpConfig: () => this.settingsManager.loadMcpConfig(),
      postMessage,
      setupSessionWatcher: () => this.storageManager.setupSessionWatcher(),
    });

    this.messageRouter = new MessageRouter({
      workspacePath: this.workspacePath,
      postMessage,
      getPanels: () => this.panelManager.getPanels(),
      storageManager: this.storageManager,
      historyManager: this.historyManager,
      settingsManager: this.settingsManager,
      workspaceManager: this.workspaceManager,
    });

    this.panelManager = new PanelManager({
      extensionUri: this.extensionUri,
      createSessionForPanel: (panel, permissionHandler) =>
        this.sessionManager.createSessionForPanel(panel, permissionHandler),
      handleWebviewMessage: (message, panelId) =>
        this.messageRouter.handleWebviewMessage(message, panelId),
      sendCurrentSettings: (panel, permissionHandler) =>
        this.settingsManager.sendCurrentSettings(panel, permissionHandler),
      getStoredSessions: () => this.storageManager.getStoredSessions(),
      invalidateSessionsCache: () => this.storageManager.invalidateSessionsCache(),
    });

    this.storageManager.setupSessionWatcher();
    this.settingsManager.loadMcpConfig().catch((err) => {
      log("[ChatPanelProvider] Error pre-loading MCP config:", err);
    });
  }

  async show(): Promise<void> {
    await this.panelManager.show();
  }

  newSession(): void {
    this.panelManager.newSession();
  }

  cancelSession(): void {
    this.panelManager.cancelSession();
  }

  dispose(): void {
    this.storageManager.dispose();
    this.workspaceManager.dispose();
    this.panelManager.dispose();
  }
}
