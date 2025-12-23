import * as vscode from 'vscode';
import { ChatPanelProvider } from './ChatPanelProvider';

let chatPanelProvider: ChatPanelProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Unbound extension activating...');

  // Create the chat panel provider
  chatPanelProvider = new ChatPanelProvider(context.extensionUri, context);

  // Register the webview view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claude-unbound.chatPanel', chatPanelProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-unbound.focusChat', () => {
      vscode.commands.executeCommand('claude-unbound.chatPanel.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-unbound.newSession', () => {
      chatPanelProvider?.newSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-unbound.cancelSession', () => {
      chatPanelProvider?.cancelSession();
    })
  );

  console.log('Claude Unbound extension activated');
}

export function deactivate() {
  chatPanelProvider?.dispose();
  console.log('Claude Unbound extension deactivated');
}
