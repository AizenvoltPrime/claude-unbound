import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { ClaudeSession } from "../claude-session";
import type { PermissionHandler } from "../PermissionHandler";
import type { ExtensionToWebviewMessage, McpServerConfig, ExtensionSettings, PermissionMode } from "../../shared/types";
import { log } from "../logger";

export interface SettingsManagerConfig {
  postMessage: (panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage) => void;
}

export class SettingsManager {
  private mcpServers: Record<string, McpServerConfig> = {};
  private mcpConfigLoaded = false;
  private readonly postMessage: SettingsManagerConfig["postMessage"];

  constructor(config: SettingsManagerConfig) {
    this.postMessage = config.postMessage;
  }

  getMcpServers(): Record<string, McpServerConfig> {
    return this.mcpServers;
  }

  getMcpConfigLoaded(): boolean {
    return this.mcpConfigLoaded;
  }

  async loadMcpConfig(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.mcpServers = {};
      this.mcpConfigLoaded = true;
      return;
    }

    const mcpConfigPath = path.join(workspaceFolder.uri.fsPath, ".mcp.json");
    try {
      const content = await fs.promises.readFile(mcpConfigPath, "utf-8");
      const config = JSON.parse(content);
      this.mcpServers = config.mcpServers || config;
    } catch {
      this.mcpServers = {};
    }
    this.mcpConfigLoaded = true;
  }

  sendCurrentSettings(panel: vscode.WebviewPanel, permissionHandler: PermissionHandler): void {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    const settings: ExtensionSettings = {
      model: config.get<string>("model", ""),
      maxTurns: config.get<number>("maxTurns", 50),
      maxBudgetUsd: config.get<number | null>("maxBudgetUsd", null),
      maxThinkingTokens: config.get<number | null>("maxThinkingTokens", null),
      betasEnabled: config.get<string[]>("betasEnabled", []),
      permissionMode: permissionHandler.getPermissionMode(),
      defaultPermissionMode: config.get<PermissionMode>("permissionMode", "default"),
      enableFileCheckpointing: config.get<boolean>("enableFileCheckpointing", true),
      sandbox: config.get<{ enabled: boolean }>("sandbox", { enabled: false }),
    };
    this.postMessage(panel, { type: "settingsUpdate", settings });
  }

  async sendAvailableModels(session: ClaudeSession, panel: vscode.WebviewPanel): Promise<void> {
    const models = await session.getSupportedModels();
    if (models && models.length > 0) {
      this.postMessage(panel, { type: "availableModels", models });
    }
  }

  async sendMcpStatus(session: ClaudeSession, panel: vscode.WebviewPanel): Promise<void> {
    const status = await session.getMcpServerStatus();
    if (status) {
      this.postMessage(panel, { type: "mcpServerStatus", servers: status });
    }
  }

  async sendSupportedCommands(session: ClaudeSession, panel: vscode.WebviewPanel): Promise<void> {
    const commands = await session.getSupportedCommands();
    if (commands) {
      this.postMessage(panel, { type: "supportedCommands", commands });
    }
  }

  async handleSetModel(session: ClaudeSession, model: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    await config.update("model", model, vscode.ConfigurationTarget.Global);
    await session.setModel(model);
  }

  async handleSetMaxThinkingTokens(session: ClaudeSession, tokens: number | null): Promise<void> {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    await config.update("maxThinkingTokens", tokens, vscode.ConfigurationTarget.Global);
    await session.setMaxThinkingTokens(tokens);
  }

  async handleSetBudgetLimit(budgetUsd: number | null): Promise<void> {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    await config.update("maxBudgetUsd", budgetUsd, vscode.ConfigurationTarget.Global);
  }

  async handleToggleBeta(beta: string, enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    const currentBetas = config.get<string[]>("betasEnabled", []);
    const newBetas = enabled
      ? [...currentBetas, beta]
      : currentBetas.filter((b) => b !== beta);
    await config.update("betasEnabled", newBetas, vscode.ConfigurationTarget.Global);
  }

  async handleSetPermissionMode(
    session: ClaudeSession,
    permissionHandler: PermissionHandler,
    mode: PermissionMode
  ): Promise<void> {
    permissionHandler.setPermissionMode(mode);
    await session.setPermissionMode(mode);
  }

  async handleSetDefaultPermissionMode(mode: PermissionMode): Promise<void> {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    await config.update("permissionMode", mode, vscode.ConfigurationTarget.Global);
  }
}
