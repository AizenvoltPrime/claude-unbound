import * as vscode from 'vscode';
import { ClaudeSession } from './ClaudeSession';
import { PermissionHandler } from './PermissionHandler';
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../shared/types';

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private webviewView: vscode.WebviewView | undefined;
  private session: ClaudeSession | undefined;
  private permissionHandler: PermissionHandler;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.permissionHandler = new PermissionHandler(extensionUri);
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
    });
  }

  private handleWebviewMessage(message: WebviewToExtensionMessage): void {
    switch (message.type) {
      case 'sendMessage':
        if (message.content.trim()) {
          // Echo user message back to webview
          this.postMessage({
            type: 'userMessage',
            content: message.content,
          });
          // Send to Claude
          this.session?.sendMessage(message.content);
        }
        break;

      case 'cancelSession':
        this.session?.cancel();
        break;

      case 'resumeSession':
        // TODO: Implement session resume
        break;

      case 'approveEdit':
        this.permissionHandler.resolveApproval(message.approved);
        break;

      case 'ready':
        // Webview is ready, send initial state if needed
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
    this.postMessage({ type: 'processing', isProcessing: false });
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
