import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { ClaudeSession } from "../claude-session";
import type { PermissionHandler } from "../PermissionHandler";
import type { PluginService } from "../PluginService";
import type { ExtensionToWebviewMessage, McpServerConfig, McpServerStatusInfo, PluginConfig, PluginStatusInfo, ExtensionSettings, PermissionMode, ProviderProfile } from "../../shared/types";
import { log } from "../logger";
import {
  getClaudeSettingsPath,
  readClaudeSettings,
  readThinkingTokensFromClaudeSettings,
  syncThinkingTokensToClaudeSettings,
} from "../claude-settings";

async function syncDisabledServersToClaudeSettings(serverName: string, disabled: boolean): Promise<void> {
  const settingsPath = getClaudeSettingsPath();
  const settings = await readClaudeSettings();

  const disabledServers = Array.isArray(settings.disabledMcpjsonServers)
    ? settings.disabledMcpjsonServers as string[]
    : [];

  if (disabled) {
    if (!disabledServers.includes(serverName)) {
      settings.disabledMcpjsonServers = [...disabledServers, serverName];
    }
  } else {
    settings.disabledMcpjsonServers = disabledServers.filter(s => s !== serverName);
  }

  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  log("[SettingsManager] syncDisabledServersToClaudeSettings: wrote to", settingsPath);
}

async function syncEnabledPluginsToClaudeSettings(pluginFullId: string, enabled: boolean): Promise<void> {
  const settingsPath = getClaudeSettingsPath();
  const settings = await readClaudeSettings();

  const enabledPlugins = (typeof settings.enabledPlugins === "object" && settings.enabledPlugins !== null)
    ? settings.enabledPlugins as Record<string, boolean>
    : {};

  enabledPlugins[pluginFullId] = enabled;
  settings.enabledPlugins = enabledPlugins;

  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  log("[SettingsManager] syncEnabledPluginsToClaudeSettings: wrote to", settingsPath);
}


interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  enabled: boolean;
}

interface PluginEntry {
  name: string;
  fullId: string;
  path: string;
  version?: string;
  description?: string;
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
  secrets: vscode.SecretStorage;
}

export class SettingsManager {
  private mcpServerEntries: McpServerEntry[] = [];
  private mcpConfigLoaded = false;
  private pluginEntries: PluginEntry[] = [];
  private pluginConfigLoaded = false;
  private readonly postMessage: SettingsManagerConfig["postMessage"];
  private readonly secrets: vscode.SecretStorage;
  private serverToggleLock: Promise<void> = Promise.resolve();
  private pluginToggleLock: Promise<void> = Promise.resolve();
  private providerProfiles: ProviderProfile[] = [];
  private activeProviderProfile: string | null = null;
  private perPanelActiveProfile: Map<string, string | null> = new Map();
  private static readonly PROFILE_SECRET_PREFIX = "claude-unbound.profile:";

  constructor(config: SettingsManagerConfig) {
    this.postMessage = config.postMessage;
    this.secrets = config.secrets;
  }

  async setServerEnabled(serverName: string, enabled: boolean): Promise<void> {
    const previousLock = this.serverToggleLock;
    let releaseLock: () => void;
    this.serverToggleLock = new Promise(resolve => { releaseLock = resolve; });

    try {
      await previousLock;

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
      const claudeSettings = await readClaudeSettings();
      const disabledServers = Array.isArray(claudeSettings.disabledMcpjsonServers)
        ? claudeSettings.disabledMcpjsonServers as string[]
        : [];

      this.mcpServerEntries = Object.entries(servers).map(([name, serverConfig]) => ({
        name,
        config: serverConfig,
        enabled: !disabledServers.includes(name),
      }));
    } catch {
      this.mcpServerEntries = [];
    }
    this.mcpConfigLoaded = true;
  }

  async sendCurrentSettings(panel: vscode.WebviewPanel, permissionHandler: PermissionHandler): Promise<void> {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    const model = config.get<string>("model", "");
    const betasEnabled = config.get<string[]>("betasEnabled", []);

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
      maxThinkingTokens: await readThinkingTokensFromClaudeSettings(),
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

  async setPluginEnabled(pluginFullId: string, enabled: boolean): Promise<void> {
    const previousLock = this.pluginToggleLock;
    let releaseLock: () => void;
    this.pluginToggleLock = new Promise(resolve => { releaseLock = resolve; });

    try {
      await previousLock;

      await syncEnabledPluginsToClaudeSettings(pluginFullId, enabled);

      const entry = this.pluginEntries.find(e => e.fullId === pluginFullId);
      if (entry) {
        entry.enabled = enabled;
      } else {
        log("[SettingsManager] setPluginEnabled: entry not found for", pluginFullId);
      }
    } finally {
      releaseLock!();
    }
  }

  getEnabledPlugins(): PluginConfig[] {
    return this.pluginEntries
      .filter(entry => entry.enabled)
      .map(entry => ({ type: "local" as const, path: entry.path }));
  }

  getEnabledPluginIds(): Set<string> {
    return new Set(
      this.pluginEntries
        .filter(entry => entry.enabled)
        .map(entry => entry.fullId)
    );
  }

  getPluginsForUI(): PluginStatusInfo[] {
    return this.pluginEntries.map(entry => ({
      name: entry.name,
      fullId: entry.fullId,
      path: entry.path,
      status: entry.enabled ? "idle" : "disabled",
      enabled: entry.enabled,
      version: entry.version,
      description: entry.description,
    }));
  }

  getPluginConfigLoaded(): boolean {
    return this.pluginConfigLoaded;
  }

  async loadPluginConfig(pluginService: PluginService): Promise<void> {
    const plugins = await pluginService.getPlugins();
    const claudeSettings = await readClaudeSettings();
    const enabledPlugins = (typeof claudeSettings.enabledPlugins === "object" && claudeSettings.enabledPlugins !== null)
      ? claudeSettings.enabledPlugins as Record<string, boolean>
      : {};

    this.pluginEntries = plugins.map(plugin => ({
      name: plugin.name,
      fullId: plugin.fullId,
      path: plugin.path,
      version: plugin.version,
      description: plugin.description,
      enabled: enabledPlugins[plugin.fullId] !== false,
    }));
    this.pluginConfigLoaded = true;
  }

  sendPluginConfig(panel: vscode.WebviewPanel): void {
    this.postMessage(panel, { type: "pluginConfigUpdate", plugins: this.getPluginsForUI() });
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
    await syncThinkingTokensToClaudeSettings(tokens);
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

  async loadProviderProfiles(): Promise<void> {
    const config = vscode.workspace.getConfiguration("claude-unbound");
    const storedProfiles = config.get<ProviderProfile[]>("providerProfiles", []);
    this.activeProviderProfile = config.get<string | null>("activeProviderProfile", null);

    // Load env vars from SecretStorage for each profile
    this.providerProfiles = await Promise.all(
      storedProfiles.map(async (profile) => {
        const secretKey = SettingsManager.PROFILE_SECRET_PREFIX + profile.name;
        const envJson = await this.secrets.get(secretKey);
        const env = envJson ? JSON.parse(envJson) as Record<string, string> : profile.env || {};
        return { name: profile.name, env };
      })
    );
  }

  async createProviderProfile(profile: ProviderProfile): Promise<void> {
    if (this.providerProfiles.some(p => p.name === profile.name)) {
      throw new Error(`Profile "${profile.name}" already exists`);
    }

    // Store env vars in SecretStorage
    const secretKey = SettingsManager.PROFILE_SECRET_PREFIX + profile.name;
    await this.secrets.store(secretKey, JSON.stringify(profile.env));

    // Store only name in VS Code settings (no env vars for security)
    this.providerProfiles = [...this.providerProfiles, profile];
    const profileNames = this.providerProfiles.map(p => ({ name: p.name }));
    await updateConfigAtEffectiveScope("claude-unbound", "providerProfiles", profileNames);
    log("[SettingsManager] createProviderProfile:", profile.name);
  }

  async updateProviderProfile(originalName: string, profile: ProviderProfile): Promise<boolean> {
    const index = this.providerProfiles.findIndex(p => p.name === originalName);
    if (index === -1) {
      throw new Error(`Profile "${originalName}" not found`);
    }

    if (originalName !== profile.name && this.providerProfiles.some(p => p.name === profile.name)) {
      throw new Error(`Profile "${profile.name}" already exists`);
    }

    // Handle secret key rename if name changed
    const oldSecretKey = SettingsManager.PROFILE_SECRET_PREFIX + originalName;
    const newSecretKey = SettingsManager.PROFILE_SECRET_PREFIX + profile.name;

    if (originalName !== profile.name) {
      // Delete old secret key
      await this.secrets.delete(oldSecretKey);
    }
    // Store env vars under (possibly new) key
    await this.secrets.store(newSecretKey, JSON.stringify(profile.env));

    this.providerProfiles = [
      ...this.providerProfiles.slice(0, index),
      profile,
      ...this.providerProfiles.slice(index + 1),
    ];
    // Store only names in VS Code settings
    const profileNames = this.providerProfiles.map(p => ({ name: p.name }));
    await updateConfigAtEffectiveScope("claude-unbound", "providerProfiles", profileNames);

    const needsRestart = this.activeProviderProfile === originalName;
    if (needsRestart) {
      this.activeProviderProfile = profile.name;
      await updateConfigAtEffectiveScope("claude-unbound", "activeProviderProfile", profile.name);
    }

    log("[SettingsManager] updateProviderProfile:", originalName, "->", profile.name);
    return needsRestart;
  }

  async deleteProviderProfile(profileName: string): Promise<boolean> {
    const profile = this.providerProfiles.find(p => p.name === profileName);
    if (!profile) {
      throw new Error(`Profile "${profileName}" not found`);
    }

    // Delete env vars from SecretStorage
    const secretKey = SettingsManager.PROFILE_SECRET_PREFIX + profileName;
    await this.secrets.delete(secretKey);

    this.providerProfiles = this.providerProfiles.filter(p => p.name !== profileName);
    // Store only names in VS Code settings
    const profileNames = this.providerProfiles.map(p => ({ name: p.name }));
    await updateConfigAtEffectiveScope("claude-unbound", "providerProfiles", profileNames);

    const needsRestart = this.activeProviderProfile === profileName;
    if (needsRestart) {
      this.activeProviderProfile = null;
      await updateConfigAtEffectiveScope("claude-unbound", "activeProviderProfile", null);
    }

    log("[SettingsManager] deleteProviderProfile:", profileName);
    return needsRestart;
  }

  async setActiveProviderProfile(profileName: string | null): Promise<boolean> {
    if (profileName === this.activeProviderProfile) {
      return false;
    }

    if (profileName !== null) {
      const profile = this.providerProfiles.find(p => p.name === profileName);
      if (!profile) {
        throw new Error(`Profile "${profileName}" not found`);
      }
    }

    this.activeProviderProfile = profileName;
    await updateConfigAtEffectiveScope("claude-unbound", "activeProviderProfile", profileName);
    log("[SettingsManager] setActiveProviderProfile:", profileName);
    return true;
  }

  getActiveProviderEnv(): Record<string, string> | undefined {
    if (!this.activeProviderProfile) {
      return undefined;
    }
    const profile = this.providerProfiles.find(p => p.name === this.activeProviderProfile);
    return profile?.env;
  }

  initPanelProfile(panelId: string): void {
    this.perPanelActiveProfile.set(panelId, this.activeProviderProfile);
  }

  cleanupPanelProfile(panelId: string): void {
    this.perPanelActiveProfile.delete(panelId);
  }

  getActiveProviderProfileForPanel(panelId: string): string | null {
    return this.perPanelActiveProfile.has(panelId)
      ? this.perPanelActiveProfile.get(panelId)!
      : this.activeProviderProfile;
  }

  setActiveProviderProfileForPanel(panelId: string, profileName: string | null): boolean {
    const currentProfile = this.perPanelActiveProfile.has(panelId)
      ? this.perPanelActiveProfile.get(panelId)!
      : this.activeProviderProfile;
    if (profileName === currentProfile) {
      return false;
    }

    if (profileName !== null) {
      const profile = this.providerProfiles.find(p => p.name === profileName);
      if (!profile) {
        throw new Error(`Profile "${profileName}" not found`);
      }
    }

    this.perPanelActiveProfile.set(panelId, profileName);
    return true;
  }

  getActiveProviderEnvForPanel(panelId: string): Record<string, string> | undefined {
    const profileName = this.perPanelActiveProfile.has(panelId)
      ? this.perPanelActiveProfile.get(panelId)
      : this.activeProviderProfile;
    if (!profileName) {
      return undefined;
    }
    const profile = this.providerProfiles.find(p => p.name === profileName);
    return profile?.env;
  }

  sendProviderProfilesForPanel(panel: vscode.WebviewPanel, panelId: string): void {
    const activeProfile = this.perPanelActiveProfile.has(panelId)
      ? this.perPanelActiveProfile.get(panelId)!
      : this.activeProviderProfile;
    this.postMessage(panel, {
      type: "providerProfilesUpdate",
      profiles: this.providerProfiles,
      activeProfile,
      defaultProfile: this.activeProviderProfile,
    });
  }

  async setDefaultProviderProfile(profileName: string | null): Promise<void> {
    if (profileName !== null) {
      const profile = this.providerProfiles.find(p => p.name === profileName);
      if (!profile) {
        throw new Error(`Profile "${profileName}" not found`);
      }
    }

    this.activeProviderProfile = profileName;
    await updateConfigAtEffectiveScope("claude-unbound", "activeProviderProfile", profileName);
    log("[SettingsManager] setDefaultProviderProfile:", profileName);
  }
}
