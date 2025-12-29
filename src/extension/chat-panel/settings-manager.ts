import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { ClaudeSession } from "../claude-session";
import type { PermissionHandler } from "../PermissionHandler";
import type { ExtensionToWebviewMessage, McpServerConfig, ExtensionSettings, PermissionMode } from "../../shared/types";
import { log } from "../logger";

/**
 * Updates a configuration value at the effective scope (workspace if set there, otherwise global).
 * This ensures updates succeed regardless of where the current value is stored.
 */
async function updateConfigAtEffectiveScope<T>(
  section: string,
  key: string,
  value: T
): Promise<void> {
  const config = vscode.workspace.getConfiguration(section);
  const inspection = config.inspect<T>(key);
  const target = inspection?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  await config.update(key, value, target);
}

const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

/**
 * Check if a model supports the 1M context window beta.
 * Only Sonnet 4 and Sonnet 4.5 models support this feature.
 */
function modelSupports1MContext(model: string): boolean {
  return /claude-sonnet-4/.test(model);
}

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
    const model = config.get<string>("model", "");
    const betasEnabled = config.get<string[]>("betasEnabled", []);

    // Filter out 1M beta if current model doesn't support it
    const effectiveBetas = betasEnabled.filter(beta => {
      if (beta === CONTEXT_1M_BETA && !modelSupports1MContext(model)) {
        return false;
      }
      return true;
    });

    const settings: ExtensionSettings = {
      model,
      maxTurns: config.get<number>("maxTurns", 50),
      maxBudgetUsd: config.get<number | null>("maxBudgetUsd", null),
      maxThinkingTokens: config.get<number | null>("maxThinkingTokens", null),
      betasEnabled: effectiveBetas,
      permissionMode: permissionHandler.getPermissionMode(),
      defaultPermissionMode: config.get<PermissionMode>("permissionMode", "default"),
      enableFileCheckpointing: config.get<boolean>("enableFileCheckpointing", true),
      sandbox: config.get<{ enabled: boolean }>("sandbox", { enabled: false }),
    };
    log('[Settings:Config] sendCurrentSettings:', JSON.stringify(settings));
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
    log('[Settings:Config] setModel:', model);
    await updateConfigAtEffectiveScope("claude-unbound", "model", model);

    // Auto-disable 1M beta if new model doesn't support it
    if (!modelSupports1MContext(model)) {
      const config = vscode.workspace.getConfiguration("claude-unbound");
      const currentBetas = config.get<string[]>("betasEnabled", []);
      if (currentBetas.includes(CONTEXT_1M_BETA)) {
        const newBetas = currentBetas.filter(b => b !== CONTEXT_1M_BETA);
        log('[Settings:Config] Auto-disabling 1M beta (unsupported by', model + ')');
        await updateConfigAtEffectiveScope("claude-unbound", "betasEnabled", newBetas);
      }
    }

    await session.setModel(model);
  }

  async handleSetMaxThinkingTokens(session: ClaudeSession, tokens: number | null): Promise<void> {
    log('[Settings:Config] setMaxThinkingTokens:', tokens);
    await updateConfigAtEffectiveScope("claude-unbound", "maxThinkingTokens", tokens);
    await session.setMaxThinkingTokens(tokens);
  }

  async handleSetBudgetLimit(budgetUsd: number | null): Promise<void> {
    log('[Settings:Config] setBudgetLimit:', budgetUsd);
    await updateConfigAtEffectiveScope("claude-unbound", "maxBudgetUsd", budgetUsd);
  }

  async handleToggleBeta(beta: string, enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    const currentBetas = config.get<string[]>("betasEnabled", []);

    // Validate 1M beta is only enabled for supported models
    if (beta === CONTEXT_1M_BETA && enabled) {
      const model = config.get<string>("model", "");
      if (!modelSupports1MContext(model)) {
        log('[Settings:Config] toggleBeta: Blocked - 1M context not supported by', model);
        return;
      }
    }

    const newBetas = enabled
      ? (currentBetas.includes(beta) ? currentBetas : [...currentBetas, beta])
      : currentBetas.filter((b) => b !== beta);
    log('[Settings:Config] toggleBeta:', beta, enabled, '→', newBetas);
    await updateConfigAtEffectiveScope("claude-unbound", "betasEnabled", newBetas);
  }

  async handleSetPermissionMode(
    session: ClaudeSession,
    permissionHandler: PermissionHandler,
    mode: PermissionMode
  ): Promise<void> {
    log('[Settings:Config] setPermissionMode:', mode);
    permissionHandler.setPermissionMode(mode);
    await session.setPermissionMode(mode);
  }

  async handleSetDefaultPermissionMode(mode: PermissionMode): Promise<void> {
    log('[Settings:Config] setDefaultPermissionMode:', mode);
    await updateConfigAtEffectiveScope("claude-unbound", "permissionMode", mode);
  }
}
