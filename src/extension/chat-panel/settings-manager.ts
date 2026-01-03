import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { ClaudeSession } from "../claude-session";
import type { PermissionHandler } from "../PermissionHandler";
import type { ExtensionToWebviewMessage, McpServerConfig, McpServerStatusInfo, ExtensionSettings, PermissionMode } from "../../shared/types";
import { log } from "../logger";

/**
 * Updates the disabledMcpjsonServers array in Claude's settings file.
 * This is required because the CLI reads from these files, not VS Code settings.
 */
async function syncDisabledServersToClaudeSettings(serverName: string, disabled: boolean): Promise<void> {
  // Try project settings first, then user settings
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const projectSettingsPath = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".claude", "settings.local.json")
    : null;
  const userSettingsPath = path.join(os.homedir(), ".claude", "settings.local.json");

  // Use project settings if it exists, otherwise user settings
  let settingsPath = userSettingsPath;
  if (projectSettingsPath) {
    try {
      await fs.promises.access(projectSettingsPath);
      settingsPath = projectSettingsPath;
    } catch {
      // Project settings doesn't exist, use user settings
    }
  }

  try {
    let settings: Record<string, unknown> = {};
    try {
      const content = await fs.promises.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content);
    } catch {
      // File doesn't exist or invalid JSON, start fresh
    }

    const disabledServers = Array.isArray(settings.disabledMcpjsonServers)
      ? settings.disabledMcpjsonServers as string[]
      : [];

    if (disabled) {
      // Add to disabled list
      if (!disabledServers.includes(serverName)) {
        settings.disabledMcpjsonServers = [...disabledServers, serverName];
      }
    } else {
      // Remove from disabled list
      settings.disabledMcpjsonServers = disabledServers.filter(s => s !== serverName);
    }

    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    log("[SettingsManager] syncDisabledServersToClaudeSettings: wrote to", settingsPath);
  } catch (err) {
    log("[SettingsManager] syncDisabledServersToClaudeSettings: failed to write", err);
  }
}

interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  enabled: boolean;
}

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
  private mcpServerEntries: McpServerEntry[] = [];
  private mcpConfigLoaded = false;
  private readonly postMessage: SettingsManagerConfig["postMessage"];
  private serverToggleLock: Promise<void> = Promise.resolve();

  constructor(config: SettingsManagerConfig) {
    this.postMessage = config.postMessage;
  }

  private getDisabledServers(): string[] {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    return config.get<string[]>("disabledMcpServers", []);
  }

  async setServerEnabled(serverName: string, enabled: boolean): Promise<void> {
    // Use mutex to prevent race conditions from rapid toggling
    const previousLock = this.serverToggleLock;
    let releaseLock: () => void;
    this.serverToggleLock = new Promise(resolve => { releaseLock = resolve; });

    try {
      await previousLock;

      const config = vscode.workspace.getConfiguration("claude-unbound");
      const disabled = config.get<string[]>("disabledMcpServers", []);

      if (enabled) {
        const newDisabled = disabled.filter(s => s !== serverName);
        await config.update("disabledMcpServers", newDisabled, vscode.ConfigurationTarget.Workspace);
      } else {
        if (!disabled.includes(serverName)) {
          await config.update("disabledMcpServers", [...disabled, serverName], vscode.ConfigurationTarget.Workspace);
        }
      }

      await syncDisabledServersToClaudeSettings(serverName, !enabled);

      const entry = this.mcpServerEntries.find(e => e.name === serverName);
      if (entry) {
        entry.enabled = enabled;
      } else {
        log("[SettingsManager] setServerEnabled: entry not found for", serverName);
      }
    } finally {
      releaseLock!();
    }
  }

  getEnabledMcpServers(): Record<string, McpServerConfig> {
    return Object.fromEntries(
      this.mcpServerEntries
        .filter(entry => entry.enabled)
        .map(entry => [entry.name, entry.config])
    );
  }

  getMcpServersForUI(): McpServerStatusInfo[] {
    return this.mcpServerEntries.map(entry => ({
      name: entry.name,
      status: entry.enabled ? "idle" : "disabled",
      enabled: entry.enabled,
    }));
  }

  getMcpConfigLoaded(): boolean {
    return this.mcpConfigLoaded;
  }

  async loadMcpConfig(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.mcpServerEntries = [];
      this.mcpConfigLoaded = true;
      return;
    }

    const mcpConfigPath = path.join(workspaceFolder.uri.fsPath, ".mcp.json");
    try {
      const content = await fs.promises.readFile(mcpConfigPath, "utf-8");
      const config = JSON.parse(content);
      const servers: Record<string, McpServerConfig> = config.mcpServers || config;
      const disabled = this.getDisabledServers();

      this.mcpServerEntries = Object.entries(servers).map(([name, serverConfig]) => ({
        name,
        config: serverConfig,
        enabled: !disabled.includes(name),
      }));
    } catch {
      this.mcpServerEntries = [];
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
      maxTurns: config.get<number>("maxTurns", 100),
      maxBudgetUsd: config.get<number | null>("maxBudgetUsd", null),
      maxThinkingTokens: config.get<number | null>("maxThinkingTokens", null),
      betasEnabled: effectiveBetas,
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
    const sdkStatus = await session.getMcpServerStatus();
    if (sdkStatus) {
      const statusMap = new Map(sdkStatus.map(s => [s.name, s]));
      const mergedServers: McpServerStatusInfo[] = this.mcpServerEntries.map(entry => {
        const sdkServer = statusMap.get(entry.name);
        return {
          name: entry.name,
          status: entry.enabled
            ? (sdkServer?.status as McpServerStatusInfo["status"]) || "pending"
            : "disabled",
          enabled: entry.enabled,
          serverInfo: sdkServer?.serverInfo,
        };
      });
      this.postMessage(panel, { type: "mcpServerStatus", servers: mergedServers });
    }
  }

  sendMcpConfig(panel: vscode.WebviewPanel): void {
    this.postMessage(panel, { type: "mcpConfigUpdate", servers: this.getMcpServersForUI() });
  }

  async sendSupportedCommands(session: ClaudeSession, panel: vscode.WebviewPanel): Promise<void> {
    const commands = await session.getSupportedCommands();
    if (commands) {
      this.postMessage(panel, { type: "supportedCommands", commands });
    }
  }

  async handleSetModel(session: ClaudeSession, model: string): Promise<void> {
    await updateConfigAtEffectiveScope("claude-unbound", "model", model);

    if (!modelSupports1MContext(model)) {
      const config = vscode.workspace.getConfiguration("claude-unbound");
      const currentBetas = config.get<string[]>("betasEnabled", []);
      if (currentBetas.includes(CONTEXT_1M_BETA)) {
        const newBetas = currentBetas.filter(b => b !== CONTEXT_1M_BETA);
        await updateConfigAtEffectiveScope("claude-unbound", "betasEnabled", newBetas);
      }
    }

    await session.setModel(model);
  }

  async handleSetMaxThinkingTokens(session: ClaudeSession, tokens: number | null): Promise<void> {
    await updateConfigAtEffectiveScope("claude-unbound", "maxThinkingTokens", tokens);
    await session.setMaxThinkingTokens(tokens);
  }

  async handleSetBudgetLimit(budgetUsd: number | null): Promise<void> {
    await updateConfigAtEffectiveScope("claude-unbound", "maxBudgetUsd", budgetUsd);
  }

  async handleToggleBeta(beta: string, enabled: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    const currentBetas = config.get<string[]>("betasEnabled", []);

    if (beta === CONTEXT_1M_BETA && enabled) {
      const model = config.get<string>("model", "");
      if (!modelSupports1MContext(model)) {
        return;
      }
    }

    const newBetas = enabled
      ? (currentBetas.includes(beta) ? currentBetas : [...currentBetas, beta])
      : currentBetas.filter((b) => b !== beta);
    await updateConfigAtEffectiveScope("claude-unbound", "betasEnabled", newBetas);
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
    await updateConfigAtEffectiveScope("claude-unbound", "permissionMode", mode);
  }
}
