import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initLogger(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Damocles');
  }
  return outputChannel;
}

export function log(...args: unknown[]): void {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Damocles');
  }
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function showLog(): void {
  outputChannel?.show();
}
