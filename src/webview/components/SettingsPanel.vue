<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { ExtensionSettings, ModelInfo } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  (e: 'openVSCodeSettings'): void;
}>();

// Local state for form inputs
const localModel = ref(props.settings.model);
const localMaxThinkingTokens = ref(props.settings.maxThinkingTokens);
const localBudgetLimit = ref(props.settings.maxBudgetUsd);
const lastThinkingTokens = ref(props.settings.maxThinkingTokens ?? 10000);

// Computed with getter/setter for derived boolean state
// This ensures the toggle is always in sync with localMaxThinkingTokens
const enableExtendedThinking = computed({
  get: () => localMaxThinkingTokens.value !== null,
  set: (enabled: boolean) => {
    if (!enabled) {
      lastThinkingTokens.value = localMaxThinkingTokens.value ?? 10000;
      localMaxThinkingTokens.value = null;
      emit('setMaxThinkingTokens', null);
    } else {
      localMaxThinkingTokens.value = lastThinkingTokens.value;
      emit('setMaxThinkingTokens', lastThinkingTokens.value);
    }
  }
});

// Sync with incoming settings (immediate: true ensures sync on mount)
watch(() => props.settings, (newSettings) => {
  localModel.value = newSettings.model;
  localMaxThinkingTokens.value = newSettings.maxThinkingTokens;
  localBudgetLimit.value = newSettings.maxBudgetUsd;
  if (newSettings.maxThinkingTokens !== null) {
    lastThinkingTokens.value = newSettings.maxThinkingTokens;
  }
}, { deep: true, immediate: true });

const is1MContextEnabled = computed({
  get: () => props.settings.betasEnabled.includes('context-1m-2025-08-07'),
  set: (enabled: boolean) => emit('toggleBeta', 'context-1m-2025-08-07', enabled)
});

// Computed for Slider (needs array format)
const thinkingTokensSliderValue = computed({
  get: () => [localMaxThinkingTokens.value ?? 10000],
  set: (val: number[]) => {
    localMaxThinkingTokens.value = val[0];
    emit('setMaxThinkingTokens', val[0]);
  }
});

function handleModelChange(value: string) {
  localModel.value = value;
  emit('setModel', value);
}

function handleBudgetChange(event: Event) {
  const inputValue = (event.target as HTMLInputElement).value;
  const value = inputValue ? parseFloat(inputValue) : null;
  localBudgetLimit.value = value;
  emit('setBudgetLimit', value);
}

// Default model options (always available)
const defaultModels: ModelInfo[] = [
  { value: 'claude-opus-4-5-20251101', displayName: 'Opus 4.5', description: 'Most capable model' },
  { value: 'claude-sonnet-4-5-20250929', displayName: 'Sonnet 4.5', description: 'Best balance of speed and capability' },
  { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest model' },
];

// Merge default models with any dynamically loaded ones
const modelOptions = computed(() => {
  // Use SDK models if available, otherwise use defaults
  if (props.availableModels.length > 0) {
    return props.availableModels;
  }
  return defaultModels;
});

// Get current model display name
const currentModelDisplayName = computed(() => {
  if (!localModel.value) return 'Opus 4.5';
  const model = modelOptions.value.find(m => m.value === localModel.value);
  return model?.displayName || localModel.value;
});
</script>

<template>
  <Sheet :open="visible" @update:open="(open: boolean) => !open && emit('close')">
    <SheetContent side="right" class="w-80 bg-unbound-bg-light border-l border-unbound-cyan-800/50 overflow-y-auto">
      <SheetHeader class="mb-6">
        <SheetTitle>Settings</SheetTitle>
      </SheetHeader>

      <!-- Model Selection -->
      <div class="mb-5">
        <Label class="block mb-2 text-unbound-cyan-300">Model</Label>
        <Select :model-value="localModel || 'claude-opus-4-5-20251101'" @update:model-value="handleModelChange">
          <SelectTrigger class="w-full bg-unbound-bg-card border-unbound-cyan-800/50">
            <SelectValue :placeholder="currentModelDisplayName" />
          </SelectTrigger>
          <SelectContent class="bg-unbound-bg-card border-unbound-cyan-800/50">
            <SelectItem
              v-for="model in modelOptions"
              :key="model.value"
              :value="model.value"
            >
              {{ model.displayName }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- Budget Limit -->
      <div class="mb-5">
        <Label class="block mb-2 text-unbound-cyan-300">Budget Limit (USD)</Label>
        <Input
          type="number"
          :model-value="localBudgetLimit ?? ''"
          step="0.1"
          min="0"
          placeholder="Unlimited"
          class="bg-unbound-bg-card border-unbound-cyan-800/50 placeholder:text-unbound-muted"
          @change="handleBudgetChange"
        />
        <p class="text-xs opacity-50 mt-1">
          Leave empty for no limit. Warning shown at 80%.
        </p>
      </div>

      <!-- Extended Thinking -->
      <div class="mb-5">
        <div class="flex items-center justify-between mb-2">
          <Label for="extended-thinking" class="text-unbound-cyan-300">
            Extended Thinking
          </Label>
          <Switch
            id="extended-thinking"
            v-model:checked="enableExtendedThinking"
          />
        </div>
        <div v-if="enableExtendedThinking" class="mt-3">
          <Slider
            v-model="thinkingTokensSliderValue"
            :min="1000"
            :max="63999"
            :step="1000"
            class="w-full"
          />
          <div class="flex justify-between text-xs opacity-50 mt-1">
            <span>1K</span>
            <span class="font-medium">{{ ((localMaxThinkingTokens ?? 10000) / 1000).toFixed(0) }}K tokens</span>
            <span>~64K</span>
          </div>
        </div>
      </div>

      <!-- Beta Features -->
      <div class="mb-5">
        <Label class="block mb-2">Beta Features</Label>
        <div class="flex items-center justify-between">
          <Label for="context-1m" class="text-sm font-normal">
            1M Context Window
          </Label>
          <Switch
            id="context-1m"
            v-model:checked="is1MContextEnabled"
          />
        </div>
        <p class="text-xs opacity-50 mt-1">
          Enable 1M token context for Sonnet 4/4.5 models
        </p>
      </div>

      <!-- Divider -->
      <Separator class="my-4" />

      <!-- VS Code Settings Link -->
      <Button
        class="w-full"
        @click="emit('openVSCodeSettings')"
      >
        Open VS Code Settings
      </Button>

      <!-- Info -->
      <p class="text-xs opacity-50 mt-4 text-center">
        Changes apply to the current session and persist in workspace settings.
      </p>
    </SheetContent>
  </Sheet>
</template>
