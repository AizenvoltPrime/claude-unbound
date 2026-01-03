import { ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  ExtensionSettings,
  ModelInfo,
  AccountInfo,
  McpServerStatusInfo,
  PermissionMode,
} from '@shared/types';

const DEFAULT_SETTINGS: ExtensionSettings = {
  model: '',
  maxTurns: 50,
  maxBudgetUsd: null,
  maxThinkingTokens: null,
  betasEnabled: [],
  permissionMode: 'default',
  defaultPermissionMode: 'default',
  enableFileCheckpointing: true,
  sandbox: { enabled: false },
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
  const budgetWarning = ref<BudgetWarningState | null>(null);

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

  function setBudgetWarning(currentSpend: number, limit: number, exceeded: boolean) {
    budgetWarning.value = { currentSpend, limit, exceeded };
  }

  function dismissBudgetWarning() {
    budgetWarning.value = null;
  }

  function $reset() {
    currentSettings.value = { ...DEFAULT_SETTINGS };
    availableModels.value = [];
    accountInfo.value = null;
    mcpServers.value = [];
    budgetWarning.value = null;
  }

  return {
    currentSettings,
    availableModels,
    accountInfo,
    mcpServers,
    budgetWarning,
    updateSettings,
    setModel,
    setPermissionMode,
    setMaxThinkingTokens,
    setBudgetLimit,
    toggleBeta,
    setDefaultPermissionMode,
    setAvailableModels,
    setAccountInfo,
    setMcpServers,
    updateMcpServerStatuses,
    setBudgetWarning,
    dismissBudgetWarning,
    $reset,
  };
});
