import * as vscode from "vscode";
import { ClaudeSession } from "../claude-session";
import { PermissionHandler } from "../PermissionHandler";
import { ensureSessionDir } from "../session";
import type { ExtensionToWebviewMessage, McpServerConfig } from "../../shared/types";

export interface SessionManagerConfig {
  workspacePath: string;
  getEnabledMcpServers: () => Record<string, McpServerConfig>;
  getMcpConfigLoaded: () => boolean;
  loadMcpConfig: () => Promise<void>;
  postMessage: (panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage) => void;
  setupSessionWatcher: () => void;
}

export class SessionManager {
  private readonly workspacePath: string;
  private readonly getEnabledMcpServers: SessionManagerConfig["getEnabledMcpServers"];
  private readonly getMcpConfigLoaded: SessionManagerConfig["getMcpConfigLoaded"];
  private readonly loadMcpConfig: SessionManagerConfig["loadMcpConfig"];
  private readonly postMessage: SessionManagerConfig["postMessage"];
  private readonly setupSessionWatcher: SessionManagerConfig["setupSessionWatcher"];

  constructor(config: SessionManagerConfig) {
    this.workspacePath = config.workspacePath;
    this.getEnabledMcpServers = config.getEnabledMcpServers;
    this.getMcpConfigLoaded = config.getMcpConfigLoaded;
    this.loadMcpConfig = config.loadMcpConfig;
    this.postMessage = config.postMessage;
    this.setupSessionWatcher = config.setupSessionWatcher;
  }

  async createSessionForPanel(
    panel: vscode.WebviewPanel,
    permissionHandler: PermissionHandler
  ): Promise<ClaudeSession> {
    if (!this.getMcpConfigLoaded()) {
      await this.loadMcpConfig();
    }

    await ensureSessionDir(this.workspacePath);

    const session = new ClaudeSession({
      cwd: this.workspacePath,
      permissionHandler: permissionHandler,
      onMessage: (message) => this.postMessage(panel, message),
      onSessionIdChange: (sessionId) => {
        this.postMessage(panel, { type: "sessionStarted", sessionId: sessionId || "" });
        this.setupSessionWatcher();
      },
      mcpServers: this.getEnabledMcpServers(),
    });

    return session;
  }
}
