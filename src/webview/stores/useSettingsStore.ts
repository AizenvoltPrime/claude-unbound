import { ref } from 'vue';
import { defineStore } from 'pinia';
import { DEFAULT_THINKING_TOKENS } from '@shared/types/constants';
import type { ExtensionSettings, ModelInfo, AccountInfo, PermissionMode, ProviderProfile } from '@shared/types/settings';
import type { McpServerStatusInfo } from '@shared/types/mcp';
import type { PluginStatusInfo } from '@shared/types/plugins';

const DEFAULT_SETTINGS: ExtensionSettings = {
  model: '',
  maxTurns: 50,
  maxBudgetUsd: null,
  maxThinkingTokens: DEFAULT_THINKING_TOKENS,
  betasEnabled: [],
  permissionMode: 'default',
  defaultPermissionMode: 'default',
  enableFileCheckpointing: true,
  sandbox: { enabled: false },
  dangerouslySkipPermissions: false,
};

export interface BudgetWarningState {
  currentSpend: number;
  limit: number;
  exceeded: boolean;
}

export const useSettingsStore = defineStore('settings', () => {
  const currentSettings = ref<ExtensionSettings>({ ...DEFAULT_SETTINGS });
  const availableModels = ref<ModelInfo[]>([]);
  const accountInfo = ref<AccountInfo | null>(null);
  const mcpServers = ref<McpServerStatusInfo[]>([]);
  const plugins = ref<PluginStatusInfo[]>([]);
  const budgetWarning = ref<BudgetWarningState | null>(null);
  const providerProfiles = ref<ProviderProfile[]>([]);
  const activeProviderProfile = ref<string | null>(null);
  const defaultProviderProfile = ref<string | null>(null);

  function updateSettings(settings: ExtensionSettings) {
    currentSettings.value = settings;
  }

  function setModel(model: string) {
    currentSettings.value.model = model;
  }

  function setPermissionMode(mode: PermissionMode) {
    currentSettings.value.permissionMode = mode;
  }

  function setMaxThinkingTokens(tokens: number | null) {
    currentSettings.value.maxThinkingTokens = tokens;
  }

  function setBudgetLimit(budgetUsd: number | null) {
    currentSettings.value.maxBudgetUsd = budgetUsd;
  }

  function toggleBeta(beta: string, enabled: boolean) {
    if (enabled) {
      currentSettings.value.betasEnabled = [...currentSettings.value.betasEnabled, beta];
    } else {
      currentSettings.value.betasEnabled = currentSettings.value.betasEnabled.filter(b => b !== beta);
    }
  }

  function setDefaultPermissionMode(mode: PermissionMode) {
    currentSettings.value.defaultPermissionMode = mode;
  }

  function setDangerouslySkipPermissions(enabled: boolean) {
    currentSettings.value.dangerouslySkipPermissions = enabled;
  }

  function setAvailableModels(models: ModelInfo[]) {
    availableModels.value = models;
  }

  function setAccountInfo(info: AccountInfo | null) {
    if (info === null) {
      accountInfo.value = null;
    } else {
      accountInfo.value = { ...accountInfo.value, ...info };
    }
  }

  function setMcpServers(servers: McpServerStatusInfo[]) {
    mcpServers.value = servers;
  }

  function updateMcpServerStatuses(sdkStatuses: { name: string; status: string }[]) {
    const statusMap = new Map(sdkStatuses.map(s => [s.name, s.status]));
    mcpServers.value = mcpServers.value.map(server => ({
      ...server,
      status: server.enabled
        ? (statusMap.get(server.name) as McpServerStatusInfo["status"]) || server.status
        : "disabled",
    }));
  }

  function setPlugins(newPlugins: PluginStatusInfo[]) {
    plugins.value = newPlugins;
  }

  function updatePluginStatuses(sdkPlugins: { name: string; path: string; version?: string; description?: string }[]) {
    const statusMap = new Map(sdkPlugins.map(p => [p.name, p]));
    plugins.value = plugins.value.map(plugin => {
      const sdkPlugin = statusMap.get(plugin.name);
      return {
        ...plugin,
        status: plugin.enabled
          ? (sdkPlugin ? "loaded" : plugin.status)
          : "disabled",
        version: sdkPlugin?.version ?? plugin.version,
        description: sdkPlugin?.description ?? plugin.description,
      } as PluginStatusInfo;
    });
  }

  function setBudgetWarning(currentSpend: number, limit: number, exceeded: boolean) {
    budgetWarning.value = { currentSpend, limit, exceeded };
  }

  function dismissBudgetWarning() {
    budgetWarning.value = null;
  }

  function setProviderProfiles(profiles: ProviderProfile[], active: string | null, defaultProfile: string | null) {
    providerProfiles.value = profiles;
    activeProviderProfile.value = active;
    defaultProviderProfile.value = defaultProfile;
  }

  function $reset() {
    currentSettings.value = { ...DEFAULT_SETTINGS };
    availableModels.value = [];
    accountInfo.value = null;
    mcpServers.value = [];
    plugins.value = [];
    budgetWarning.value = null;
    providerProfiles.value = [];
    activeProviderProfile.value = null;
    defaultProviderProfile.value = null;
  }

  return {
    currentSettings,
    availableModels,
    accountInfo,
    mcpServers,
    plugins,
    budgetWarning,
    providerProfiles,
    activeProviderProfile,
    defaultProviderProfile,
    updateSettings,
    setModel,
    setPermissionMode,
    setMaxThinkingTokens,
    setBudgetLimit,
    toggleBeta,
    setDefaultPermissionMode,
    setDangerouslySkipPermissions,
    setAvailableModels,
    setAccountInfo,
    setMcpServers,
    updateMcpServerStatuses,
    setPlugins,
    updatePluginStatuses,
    setBudgetWarning,
    dismissBudgetWarning,
    setProviderProfiles,
    $reset,
  };
});
