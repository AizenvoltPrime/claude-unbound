import * as vscode from 'vscode';
import { ClaudeSession } from './ClaudeSession';
import { PermissionHandler } from './PermissionHandler';
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../shared/types';

interface StoredSession {
  id: string;
  timestamp: number;
  preview: string;
}

const SESSION_STORAGE_KEY = 'claude-unbound.sessions';
const MAX_STORED_SESSIONS = 10;

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private webviewView: vscode.WebviewView | undefined;
  private session: ClaudeSession | undefined;
  private permissionHandler: PermissionHandler;
  private disposables: vscode.Disposable[] = [];
  private currentSessionPreview: string = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.permissionHandler = new PermissionHandler(extensionUri);
  }

  private getStoredSessions(): StoredSession[] {
    return this.context.globalState.get<StoredSession[]>(SESSION_STORAGE_KEY, []);
  }

  private storeSession(sessionId: string, preview: string): void {
    const sessions = this.getStoredSessions();
    const existingIndex = sessions.findIndex(s => s.id === sessionId);

    if (existingIndex >= 0) {
      sessions[existingIndex].timestamp = Date.now();
      sessions[existingIndex].preview = preview;
    } else {
      sessions.unshift({
        id: sessionId,
        timestamp: Date.now(),
        preview: preview.slice(0, 100),
      });
    }

    // Keep only the most recent sessions
    const trimmedSessions = sessions.slice(0, MAX_STORED_SESSIONS);
    this.context.globalState.update(SESSION_STORAGE_KEY, trimmedSessions);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Handle messages from webview
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
        this.handleWebviewMessage(message);
      })
    );

    // Initialize session
    this.initSession();
  }

  private initSession(): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    this.session = new ClaudeSession({
      cwd: workspaceFolder,
      permissionHandler: this.permissionHandler,
      onMessage: (message) => this.postMessage(message),
      onSessionIdChange: (sessionId) => {
        if (sessionId && this.currentSessionPreview) {
          this.storeSession(sessionId, this.currentSessionPreview);
        }
        this.postMessage({ type: 'sessionStarted', sessionId: sessionId || '' });
      },
    });
  }

  private handleWebviewMessage(message: WebviewToExtensionMessage): void {
    switch (message.type) {
      case 'sendMessage':
        if (message.content.trim()) {
          // Track first message as session preview
          if (!this.currentSessionPreview) {
            this.currentSessionPreview = message.content.trim();
          }
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
        this.permissionHandler.resolveApproval(message.approved);
        break;

      case 'ready':
        // Webview is ready, send stored sessions list if any
        const sessions = this.getStoredSessions();
        if (sessions.length > 0) {
          this.postMessage({ type: 'storedSessions', sessions });
        }
        break;
    }
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    this.webviewView?.webview.postMessage(message);
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
    this.currentSessionPreview = '';
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
