import * as vscode from "vscode";
import { ChatPanelProvider } from "./chat-panel";
import { initLogger, log, showLog } from "./logger";

let chatPanelProvider: ChatPanelProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = initLogger();
  context.subscriptions.push(outputChannel);
  log("Claude Unbound extension activating...");
  showLog();

  chatPanelProvider = new ChatPanelProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("claude-unbound.chat", {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
        await chatPanelProvider?.restorePanel(panel);
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-unbound.openChat", () => {
      chatPanelProvider?.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-unbound.newSession", () => {
      chatPanelProvider?.newSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-unbound.cancelSession", () => {
      chatPanelProvider?.cancelSession();
    })
  );

  log("Claude Unbound extension activated");
}

export function deactivate() {
  chatPanelProvider?.dispose();
  log("Claude Unbound extension deactivated");
}
