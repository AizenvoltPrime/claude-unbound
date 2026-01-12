import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ChatPanelProvider } from "./chat-panel";
import { initLogger, log, showLog } from "./logger";

let chatPanelProvider: ChatPanelProvider | undefined;

async function fixSdkBinaryPermissions(extensionUri: vscode.Uri): Promise<void> {
  if (process.platform === "win32") return;

  const sdkVendorPath = path.join(
    extensionUri.fsPath,
    "node_modules",
    "@anthropic-ai",
    "claude-agent-sdk",
    "vendor"
  );

  const binaries = [
    path.join(sdkVendorPath, "ripgrep", "x64-linux", "rg"),
    path.join(sdkVendorPath, "ripgrep", "arm64-linux", "rg"),
    path.join(sdkVendorPath, "ripgrep", "x64-darwin", "rg"),
    path.join(sdkVendorPath, "ripgrep", "arm64-darwin", "rg"),
  ];

  for (const binary of binaries) {
    try {
      await fs.promises.access(binary, fs.constants.F_OK);
      await fs.promises.chmod(binary, 0o755);
      log(`[Permissions] Fixed execute permission: ${binary}`);
    } catch {}
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = initLogger();
  context.subscriptions.push(outputChannel);
  log("Claude Unbound extension activating...");
  showLog();

  await fixSdkBinaryPermissions(context.extensionUri);

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
