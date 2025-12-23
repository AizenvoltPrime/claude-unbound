<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { ExtensionSettings, ModelInfo, PermissionMode } from '@shared/types';

const props = defineProps<{
  settings: ExtensionSettings;
  availableModels: ModelInfo[];
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'setModel', model: string): void;
  (e: 'setMaxThinkingTokens', tokens: number | null): void;
  (e: 'setBudgetLimit', budgetUsd: number | null): void;
  (e: 'toggleBeta', beta: string, enabled: boolean): void;
  (e: 'setPermissionMode', mode: PermissionMode): void;
  (e: 'openVSCodeSettings'): void;
}>();

// Local state for form inputs
const localModel = ref(props.settings.model);
const localMaxThinkingTokens = ref(props.settings.maxThinkingTokens);
const localBudgetLimit = ref(props.settings.maxBudgetUsd);
const localPermissionMode = ref(props.settings.permissionMode);
const enableExtendedThinking = ref(props.settings.maxThinkingTokens !== null);

// Sync with incoming settings
watch(() => props.settings, (newSettings) => {
  localModel.value = newSettings.model;
  localMaxThinkingTokens.value = newSettings.maxThinkingTokens;
  localBudgetLimit.value = newSettings.maxBudgetUsd;
  localPermissionMode.value = newSettings.permissionMode;
  enableExtendedThinking.value = newSettings.maxThinkingTokens !== null;
}, { deep: true });

const is1MContextEnabled = computed(() =>
  props.settings.betasEnabled.includes('context-1m-2025-08-07')
);

function handleModelChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  localModel.value = value;
  emit('setModel', value);
}

function handleThinkingToggle(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  enableExtendedThinking.value = enabled;
  if (!enabled) {
    localMaxThinkingTokens.value = null;
    emit('setMaxThinkingTokens', null);
  } else {
    localMaxThinkingTokens.value = 10000;
    emit('setMaxThinkingTokens', 10000);
  }
}

function handleThinkingTokensChange(event: Event) {
  const value = parseInt((event.target as HTMLInputElement).value, 10);
  localMaxThinkingTokens.value = value;
  emit('setMaxThinkingTokens', value);
}

function handleBudgetChange(event: Event) {
  const inputValue = (event.target as HTMLInputElement).value;
  const value = inputValue ? parseFloat(inputValue) : null;
  localBudgetLimit.value = value;
  emit('setBudgetLimit', value);
}

function handleContextBetaToggle(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  emit('toggleBeta', 'context-1m-2025-08-07', enabled);
}

function handlePermissionModeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as PermissionMode;
  localPermissionMode.value = value;
  emit('setPermissionMode', value);
}

const permissionModeOptions: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'default', label: 'Default', description: 'Prompts for dangerous operations' },
  { value: 'acceptEdits', label: 'Accept Edits', description: 'Auto-accept file edit operations' },
  { value: 'bypassPermissions', label: 'Bypass All', description: 'Skip all permission checks (use with caution)' },
  { value: 'plan', label: 'Plan Only', description: 'Read-only mode, no execution' },
];

// Default model options (always available)
const defaultModels: ModelInfo[] = [
  { value: 'claude-opus-4-5-20251101', displayName: 'Claude Opus 4.5', description: 'Most capable model' },
  { value: 'claude-sonnet-4-5-20250929', displayName: 'Claude Sonnet 4.5', description: 'Best balance of speed and capability' },
  { value: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', description: 'Fastest model' },
];

// Merge default models with any dynamically loaded ones
const modelOptions = computed(() => {
  // Use SDK models if available, otherwise use defaults
  if (props.availableModels.length > 0) {
    return props.availableModels;
  }
  return defaultModels;
});
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/50 z-40"
        @click="emit('close')"
      />
    </Transition>
    <Transition name="slide">
      <div
        v-if="visible"
        class="fixed right-0 top-0 bottom-0 w-80 bg-unbound-bg-light border-l border-unbound-cyan-800/50 z-50 overflow-y-auto"
      >
        <div class="p-4">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-lg font-semibold">Settings</h2>
            <button
              class="text-xl opacity-70 hover:opacity-100"
              @click="emit('close')"
            >
              &times;
            </button>
          </div>

          <!-- Model Selection -->
          <div class="mb-5">
            <label class="block text-sm font-medium mb-2 text-unbound-cyan-300">Model</label>
            <select
              :value="localModel"
              class="w-full p-2 rounded bg-unbound-bg-card border border-unbound-cyan-800/50 text-sm text-unbound-text"
              @change="handleModelChange"
            >
              <option value="">Default (Opus 4.5)</option>
              <option
                v-for="model in modelOptions"
                :key="model.value"
                :value="model.value"
              >
                {{ model.displayName }}
              </option>
            </select>
          </div>

          <!-- Permission Mode -->
          <div class="mb-5">
            <label class="block text-sm font-medium mb-2 text-unbound-cyan-300">Permission Mode</label>
            <select
              :value="localPermissionMode"
              class="w-full p-2 rounded bg-unbound-bg-card border border-unbound-cyan-800/50 text-sm text-unbound-text"
              @change="handlePermissionModeChange"
            >
              <option
                v-for="option in permissionModeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <p class="text-xs opacity-50 mt-1">
              {{ permissionModeOptions.find(o => o.value === localPermissionMode)?.description }}
            </p>
          </div>

          <!-- Budget Limit -->
          <div class="mb-5">
            <label class="block text-sm font-medium mb-2 text-unbound-cyan-300">Budget Limit (USD)</label>
            <input
              type="number"
              :value="localBudgetLimit ?? ''"
              step="0.1"
              min="0"
              placeholder="Unlimited"
              class="w-full p-2 rounded bg-unbound-bg-card border border-unbound-cyan-800/50 text-sm text-unbound-text placeholder:text-unbound-muted"
              @change="handleBudgetChange"
            />
            <p class="text-xs opacity-50 mt-1">
              Leave empty for no limit. Warning shown at 80%.
            </p>
          </div>

          <!-- Extended Thinking -->
          <div class="mb-5">
            <div class="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="extended-thinking"
                :checked="enableExtendedThinking"
                class="rounded accent-unbound-cyan-500"
                @change="handleThinkingToggle"
              />
              <label for="extended-thinking" class="text-sm font-medium text-unbound-cyan-300">
                Extended Thinking
              </label>
            </div>
            <div v-if="enableExtendedThinking" class="mt-2">
              <input
                type="range"
                :value="localMaxThinkingTokens ?? 10000"
                min="1000"
                max="100000"
                step="1000"
                class="w-full"
                @input="handleThinkingTokensChange"
              />
              <div class="flex justify-between text-xs opacity-50">
                <span>1K</span>
                <span class="font-medium">{{ ((localMaxThinkingTokens ?? 10000) / 1000).toFixed(0) }}K tokens</span>
                <span>100K</span>
              </div>
            </div>
          </div>

          <!-- Beta Features -->
          <div class="mb-5">
            <label class="block text-sm font-medium mb-2">Beta Features</label>
            <div class="flex items-center gap-2">
              <input
                type="checkbox"
                id="context-1m"
                :checked="is1MContextEnabled"
                class="rounded"
                @change="handleContextBetaToggle"
              />
              <label for="context-1m" class="text-sm">
                1M Context Window
              </label>
            </div>
            <p class="text-xs opacity-50 mt-1">
              Enable 1M token context for Sonnet 4/4.5 models
            </p>
          </div>

          <!-- Divider -->
          <hr class="border-vscode-border my-4" />

          <!-- VS Code Settings Link -->
          <button
            class="w-full py-2 px-3 rounded bg-vscode-button-bg text-vscode-button-fg text-sm hover:opacity-90 flex items-center justify-center gap-2"
            @click="emit('openVSCodeSettings')"
          >
            <span>Open VS Code Settings</span>
          </button>

          <!-- Info -->
          <p class="text-xs opacity-50 mt-4 text-center">
            Changes apply to the current session and persist in workspace settings.
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
