import * as vscode from 'vscode';
import { ChatPanelProvider } from './ChatPanelProvider';

let chatPanelProvider: ChatPanelProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Unbound extension activating...');

  chatPanelProvider = new ChatPanelProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-unbound.openChat', () => {
      chatPanelProvider?.show();
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
