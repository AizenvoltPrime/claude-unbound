import * as vscode from "vscode";
import { PermissionHandler } from "../PermissionHandler";
import { IdeContextManager } from "./ide-context-manager";
import type { ClaudeSession } from "../claude-session";
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage, StoredSession } from "../../shared/types";
import type { PanelInstance } from "./types";

export interface PanelManagerConfig {
  extensionUri: vscode.Uri;
  createSessionForPanel: (
    panel: vscode.WebviewPanel,
    permissionHandler: PermissionHandler
  ) => Promise<ClaudeSession>;
  handleWebviewMessage: (message: WebviewToExtensionMessage, panelId: string) => Promise<void>;
  sendCurrentSettings: (panel: vscode.WebviewPanel, permissionHandler: PermissionHandler) => Promise<void>;
  getStoredSessions: () => Promise<{ sessions: StoredSession[]; hasMore: boolean; nextOffset: number }>;
  invalidateSessionsCache: () => void;
}

export class PanelManager {
  private panels: Map<string, PanelInstance> = new Map();
  private panelCounter = 0;
  private readonly extensionUri: vscode.Uri;
  private readonly createSessionForPanel: PanelManagerConfig["createSessionForPanel"];
  private readonly handleWebviewMessage: PanelManagerConfig["handleWebviewMessage"];
  private readonly sendCurrentSettings: PanelManagerConfig["sendCurrentSettings"];
  private readonly getStoredSessions: PanelManagerConfig["getStoredSessions"];
  private readonly invalidateSessionsCache: PanelManagerConfig["invalidateSessionsCache"];

  constructor(config: PanelManagerConfig) {
    this.extensionUri = config.extensionUri;
    this.createSessionForPanel = config.createSessionForPanel;
    this.handleWebviewMessage = config.handleWebviewMessage;
    this.sendCurrentSettings = config.sendCurrentSettings;
    this.getStoredSessions = config.getStoredSessions;
    this.invalidateSessionsCache = config.invalidateSessionsCache;
  }

  getPanels(): Map<string, PanelInstance> {
    return this.panels;
  }

  async show(): Promise<void> {
    let targetColumn: vscode.ViewColumn;
    let lockEditorGroup = false;

    const existingColumn = this.findExistingPanelColumn();
    if (existingColumn) {
      targetColumn = existingColumn;
    } else {
      targetColumn = this.findUnusedColumn();
      lockEditorGroup = true;
    }

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

    await this.initializePanel(panel, lockEditorGroup);
  }

  async restorePanel(panel: vscode.WebviewPanel): Promise<void> {
    await this.initializePanel(panel, false);
  }

  private async initializePanel(panel: vscode.WebviewPanel, lockEditorGroup: boolean): Promise<void> {
    const panelId = `panel-${++this.panelCounter}`;

    panel.webview.html = this.getHtmlContent(panel.webview);
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "resources", "icon.png");

    if (lockEditorGroup) {
      await vscode.commands.executeCommand("workbench.action.lockEditorGroup");
    }

    const panelDisposables: vscode.Disposable[] = [];

    const permissionHandler = new PermissionHandler(this.extensionUri);
    permissionHandler.setPostMessage((msg) => this.postMessageToPanel(panel, msg));

    const ideContextManager = new IdeContextManager("vscode-webview", (context) => {
      this.postMessageToPanel(panel, { type: "ideContextUpdate", context });
    });

    const session = await this.createSessionForPanel(panel, permissionHandler);

    this.panels.set(panelId, { panel, session, permissionHandler, ideContextManager, disposables: panelDisposables });

    panelDisposables.push(
      panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) {
          this.postMessageToPanel(panel, { type: "panelFocused" });
          this.invalidateSessionsCache();
          this.getStoredSessions()
            .then(({ sessions, hasMore, nextOffset }) => {
              this.postMessageToPanel(panel, {
                type: "storedSessions",
                sessions,
                hasMore,
                nextOffset,
                isFirstPage: true,
              });
            })
            .catch(() => {});
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
        if (e.affectsConfiguration("claude-unbound")) {
          void this.sendCurrentSettings(panel, permissionHandler);
        }
      })
    );

    panel.onDidDispose(() => {
      const instance = this.panels.get(panelId);
      if (instance) {
        instance.session.cancel();
        instance.permissionHandler.dispose();
        instance.ideContextManager.dispose();
        instance.disposables.forEach((d) => d.dispose());
        this.panels.delete(panelId);
      }
    });
  }

  postMessageToPanel(panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage): void {
    try {
      panel.webview.postMessage(message);
    } catch {
      // Panel was disposed - will be cleaned up by onDidDispose handler
    }
  }

  broadcastToAllPanels(message: ExtensionToWebviewMessage): void {
    for (const [, instance] of this.panels) {
      this.postMessageToPanel(instance.panel, message);
    }
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
      instance.ideContextManager.dispose();
      instance.disposables.forEach((d) => d.dispose());
      instance.panel.dispose();
    }
    this.panels.clear();
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

  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "index.css")
    );
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "resources", "icon.png"));

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
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
}
