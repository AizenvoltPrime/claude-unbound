import * as vscode from "vscode";
import * as path from "path";
import { SlashCommandService } from "../SlashCommandService";
import { BUILTIN_SLASH_COMMANDS } from "../../shared/slashCommands";
import { listWorkspaceFiles, type FileResult } from "../ripgrep";
import type { ExtensionToWebviewMessage, SlashCommandItem, WorkspaceFileInfo } from "../../shared/types";
import { log } from "../logger";

export interface WorkspaceManagerConfig {
  workspacePath: string;
  postMessage: (panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage) => void;
}

export class WorkspaceManager {
  private readonly workspacePath: string;
  private readonly postMessage: WorkspaceManagerConfig["postMessage"];
  private readonly slashCommandService: SlashCommandService;

  constructor(config: WorkspaceManagerConfig) {
    this.workspacePath = config.workspacePath;
    this.postMessage = config.postMessage;
    this.slashCommandService = new SlashCommandService(this.workspacePath);
  }

  async getCustomSlashCommands(): Promise<SlashCommandItem[]> {
    const customCommands = await this.slashCommandService.getCommands();
    const allCommands = [...BUILTIN_SLASH_COMMANDS, ...customCommands];
    return allCommands.sort((a, b) => a.name.localeCompare(b.name));
  }

  async sendCustomSlashCommands(panel: vscode.WebviewPanel): Promise<void> {
    try {
      const commands = await this.getCustomSlashCommands();
      this.postMessage(panel, { type: "customSlashCommands", commands });
    } catch (err) {
      log("[WorkspaceManager] Error fetching custom slash commands:", err);
      this.postMessage(panel, { type: "customSlashCommands", commands: BUILTIN_SLASH_COMMANDS });
    }
  }

  async getWorkspaceFiles(): Promise<WorkspaceFileInfo[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }
    const files = await listWorkspaceFiles(workspaceFolder.uri.fsPath);
    return files.map((f: FileResult) => ({
      relativePath: f.relativePath,
      isDirectory: f.isDirectory,
    }));
  }

  async sendWorkspaceFiles(panel: vscode.WebviewPanel): Promise<void> {
    try {
      const files = await this.getWorkspaceFiles();
      this.postMessage(panel, { type: "workspaceFiles", files });
    } catch (err) {
      log("[WorkspaceManager] Error fetching workspace files:", err);
      this.postMessage(panel, { type: "workspaceFiles", files: [] });
    }
  }

  async openFile(filePath: string, line?: number): Promise<void> {
    let resolvedPath = filePath;

    if (filePath.startsWith("./") && this.workspacePath) {
      const absolutePath = path.resolve(this.workspacePath, filePath.slice(2));
      if (!absolutePath.startsWith(this.workspacePath)) {
        throw new Error("Path traversal attempt detected");
      }
      resolvedPath = absolutePath;
    }

    const uri = vscode.Uri.file(resolvedPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);

    if (line && line > 0) {
      const position = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  }

  async handleOpenFile(panel: vscode.WebviewPanel, filePath: string, line?: number): Promise<void> {
    try {
      await this.openFile(filePath, line);
    } catch (err) {
      log("[WorkspaceManager] Error opening file:", err);
      vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
    }
  }

  dispose(): void {
    this.slashCommandService.dispose();
  }
}
