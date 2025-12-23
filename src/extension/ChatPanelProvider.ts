import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ClaudeSession } from './ClaudeSession';
import { PermissionHandler } from './PermissionHandler';
import {
  listSessions,
  getSessionDir,
  ensureSessionDir,
  type StoredSession,
} from './SessionStorage';
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  McpServerConfig,
  ExtensionSettings,
  PermissionMode,
} from '../shared/types';

const MAX_STORED_SESSIONS = 20;

export class ChatPanelProvider {
  private panel: vscode.WebviewPanel | undefined;
  private session: ClaudeSession | undefined;
  private permissionHandler: PermissionHandler;
  private disposables: vscode.Disposable[] = [];
  private mcpServers: Record<string, McpServerConfig> = {};
  private workspacePath: string = '';
  private panelViewColumn: vscode.ViewColumn | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.permissionHandler = new PermissionHandler(extensionUri);
    // Set workspace path
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homeDir;
    // Load MCP servers from .mcp.json
    this.loadMcpConfig();
  }

  private async loadMcpConfig(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.mcpServers = {};
      return;
    }

    const mcpConfigPath = path.join(workspaceFolder.uri.fsPath, '.mcp.json');
    try {
      const content = await fs.promises.readFile(mcpConfigPath, 'utf-8');
      const config = JSON.parse(content);
      // Support both { mcpServers: {...} } and direct {...} format
      this.mcpServers = config.mcpServers || config;
    } catch {
      // No .mcp.json found or invalid format
      this.mcpServers = {};
    }
  }

  private async getStoredSessions(): Promise<StoredSession[]> {
    // Read sessions from Claude Code CLI directory
    const sessions = await listSessions(this.workspacePath);
    return sessions.slice(0, MAX_STORED_SESSIONS);
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      return;
    }

    // Store current active editor to restore focus later
    const activeEditor = vscode.window.activeTextEditor;

    this.panel = vscode.window.createWebviewPanel(
      'claude-unbound.chat',
      'Claude Unbound',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        ],
      }
    );

    this.panel.webview.html = this.getHtmlContent(this.panel.webview);

    // Wire up permission handler to send messages to webview
    this.permissionHandler.setPostMessage((msg) => this.postMessage(msg));

    // Track the panel's view column
    this.panelViewColumn = this.panel.viewColumn;

    // Update tracked column when panel moves
    this.panel.onDidChangeViewState((e) => {
      this.panelViewColumn = e.webviewPanel.viewColumn;
    }, null, this.disposables);

    // Intercept file opens: if a file opens in the same group as our panel, move it to group 1
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (!editor || !this.panel || !this.panelViewColumn) return;

        // If the editor opened in the same column as our panel, move it to column 1
        if (editor.viewColumn === this.panelViewColumn && this.panelViewColumn !== vscode.ViewColumn.One) {
          await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.One, false);
        }
      })
    );

    // Restore focus to the original editor so files open in the correct group
    if (activeEditor) {
      vscode.window.showTextDocument(activeEditor.document, activeEditor.viewColumn, false);
    } else {
      vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    }

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
        this.handleWebviewMessage(message);
      })
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.panelViewColumn = undefined;
    }, null, this.disposables);

    this.initSession();
  }

  private async initSession(): Promise<void> {
    // Ensure MCP config is loaded
    await this.loadMcpConfig();

    // Ensure session directory exists for Claude Code compatibility
    await ensureSessionDir(this.workspacePath);

    this.session = new ClaudeSession({
      cwd: this.workspacePath,
      permissionHandler: this.permissionHandler,
      onMessage: (message) => this.postMessage(message),
      onSessionIdChange: (sessionId) => {
        // Sessions are now saved by the SDK to the Claude Code directory
        // No need to manually store - just notify webview
        this.postMessage({ type: 'sessionStarted', sessionId: sessionId || '' });
      },
      mcpServers: this.mcpServers,
    });
  }

  private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
    // Import log dynamically to avoid circular deps
    const { log } = await import('./logger');

    switch (message.type) {
      case 'log':
        // Forward webview logs to VS Code output channel
        log('[Webview]', message.message);
        break;

      case 'sendMessage':
        if (message.content.trim()) {
          // Echo user message back to webview
          this.postMessage({
            type: 'userMessage',
            content: message.content,
          });
          // Send to Claude with optional agent
          this.session?.sendMessage(message.content, message.agentId);
        }
        break;

      case 'cancelSession':
        this.session?.cancel();
        break;

      case 'resumeSession':
        if (message.sessionId) {
          this.session?.setResumeSession(message.sessionId);
          this.postMessage({ type: 'sessionStarted', sessionId: message.sessionId });
        }
        break;

      case 'approveEdit':
        this.permissionHandler.resolveApproval(message.approved, {
          neverAskAgain: message.neverAskAgain,
          customMessage: message.customMessage,
        });
        break;

      case 'ready': {
        // Webview is ready, send stored sessions list from Claude Code directory
        this.getStoredSessions().then(sessions => {
          if (sessions.length > 0) {
            this.postMessage({ type: 'storedSessions', sessions });
          }
        });
        // Send current settings
        this.sendCurrentSettings();
        // Request available models (will be sent when session has a query)
        this.sendAvailableModels();
        break;
      }

      // === New: Model and settings control ===
      case 'requestModels':
        this.sendAvailableModels();
        break;

      case 'setModel': {
        const config = vscode.workspace.getConfiguration('claude-unbound');
        await config.update('model', message.model, vscode.ConfigurationTarget.Workspace);
        await this.session?.setModel(message.model);
        break;
      }

      case 'setMaxThinkingTokens': {
        const config = vscode.workspace.getConfiguration('claude-unbound');
        await config.update('maxThinkingTokens', message.tokens, vscode.ConfigurationTarget.Workspace);
        await this.session?.setMaxThinkingTokens(message.tokens);
        break;
      }

      case 'setBudgetLimit': {
        const config = vscode.workspace.getConfiguration('claude-unbound');
        await config.update('maxBudgetUsd', message.budgetUsd, vscode.ConfigurationTarget.Workspace);
        break;
      }

      case 'toggleBeta': {
        const config = vscode.workspace.getConfiguration('claude-unbound');
        const currentBetas = config.get<string[]>('betasEnabled', []);
        const newBetas = message.enabled
          ? [...currentBetas, message.beta]
          : currentBetas.filter(b => b !== message.beta);
        await config.update('betasEnabled', newBetas, vscode.ConfigurationTarget.Workspace);
        break;
      }

      case 'setPermissionMode': {
        const config = vscode.workspace.getConfiguration('claude-unbound');
        await config.update('permissionMode', message.mode, vscode.ConfigurationTarget.Workspace);
        await this.session?.setPermissionMode(message.mode);
        break;
      }

      // === New: File rewind ===
      case 'rewindToMessage':
        await this.session?.rewindFiles(message.userMessageId);
        break;

      // === New: Session control ===
      case 'interrupt':
        await this.session?.interrupt();
        break;

      case 'requestMcpStatus':
        this.sendMcpStatus();
        break;

      case 'requestSupportedCommands':
        this.sendSupportedCommands();
        break;

      case 'openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'claude-unbound');
        break;
    }
  }

  private sendCurrentSettings(): void {
    const config = vscode.workspace.getConfiguration('claude-unbound');
    const settings: ExtensionSettings = {
      model: config.get<string>('model', ''),
      maxTurns: config.get<number>('maxTurns', 50),
      maxBudgetUsd: config.get<number | null>('maxBudgetUsd', null),
      maxThinkingTokens: config.get<number | null>('maxThinkingTokens', null),
      betasEnabled: config.get<string[]>('betasEnabled', []),
      permissionMode: config.get<PermissionMode>('permissionMode', 'default'),
      enableFileCheckpointing: config.get<boolean>('enableFileCheckpointing', true),
      sandbox: config.get('sandbox', { enabled: false }),
    };
    this.postMessage({ type: 'settingsUpdate', settings });
  }

  private async sendAvailableModels(): Promise<void> {
    const models = await this.session?.getSupportedModels();
    if (models && models.length > 0) {
      this.postMessage({ type: 'availableModels', models });
    }
  }

  private async sendMcpStatus(): Promise<void> {
    const status = await this.session?.getMcpServerStatus();
    if (status) {
      this.postMessage({ type: 'mcpServerStatus', servers: status });
    }
  }

  private async sendSupportedCommands(): Promise<void> {
    const commands = await this.session?.getSupportedCommands();
    if (commands) {
      this.postMessage({ type: 'supportedCommands', commands });
    }
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    this.panel?.webview.postMessage(message);
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets', 'index.css')
    );

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
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  newSession(): void {
    this.session?.reset();
    this.postMessage({ type: 'processing', isProcessing: false });
    this.postMessage({ type: 'sessionCleared' });
  }

  cancelSession(): void {
    this.session?.cancel();
  }

  dispose(): void {
    this.session?.cancel();
    this.permissionHandler.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
