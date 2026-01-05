<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { setLocale, i18n } from '@/i18n';
import type { ExtensionSettings, ModelInfo, PermissionMode } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
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

const { t } = useI18n();

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
  (e: 'setDefaultPermissionMode', mode: PermissionMode): void;
  (e: 'openVSCodeSettings'): void;
}>();

const permissionModeOptions = computed<{ value: PermissionMode; label: string; description: string }[]>(() => [
  { value: 'default', label: t('settings.permissionOptions.default.label'), description: t('settings.permissionOptions.default.description') },
  { value: 'acceptEdits', label: t('settings.permissionOptions.acceptEdits.label'), description: t('settings.permissionOptions.acceptEdits.description') },
  { value: 'bypassPermissions', label: t('settings.permissionOptions.bypassPermissions.label'), description: t('settings.permissionOptions.bypassPermissions.description') },
  { value: 'plan', label: t('settings.permissionOptions.plan.label'), description: t('settings.permissionOptions.plan.description') },
]);

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'el', label: 'Ελληνικά' },
];

const currentLocale = computed(() => i18n.global.locale.value);

function handleLanguageChange(value: string) {
  setLocale(value);
}

function handleDefaultModeChange(mode: string) {
  emit('setDefaultPermissionMode', mode as PermissionMode);
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible) {
    emit('close');
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

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

const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

// Only Sonnet 4 and 4.5 support 1M context
const modelSupports1MContext = computed(() => {
  const model = localModel.value || '';
  return /claude-sonnet-4/.test(model);
});

const is1MContextEnabled = computed({
  get: () => props.settings.betasEnabled.includes(CONTEXT_1M_BETA),
  set: (enabled: boolean) => {
    if (enabled && !modelSupports1MContext.value) return;
    emit('toggleBeta', CONTEXT_1M_BETA, enabled);
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

function handleThinkingTokensChange(event: Event) {
  const inputValue = (event.target as HTMLInputElement).value;
  const value = inputValue ? parseInt(inputValue, 10) : 10000;
  const clamped = Math.min(63999, Math.max(1000, value));
  localMaxThinkingTokens.value = clamped;
  emit('setMaxThinkingTokens', clamped);
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
    <SheetContent side="right" class="w-80 bg-card border-l border-border overflow-y-auto">
      <SheetHeader class="mb-6">
        <SheetTitle class="text-foreground">{{ t('settings.title') }}</SheetTitle>
      </SheetHeader>

      <!-- Default Permission Mode -->
      <div class="mb-5">
        <Label class="block mb-2 text-primary font-medium">{{ t('settings.defaultPermissionMode') }}</Label>
        <Select :model-value="settings.defaultPermissionMode" @update:model-value="handleDefaultModeChange">
          <SelectTrigger class="w-full bg-input border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent class="bg-popover border-border">
            <SelectItem
              v-for="option in permissionModeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p class="text-xs text-muted-foreground mt-1">
          {{ t('settings.defaultPermissionModeDescription') }}
        </p>
      </div>

      <!-- Model Selection -->
      <div class="mb-5">
        <Label class="block mb-2 text-primary font-medium">{{ t('settings.model') }}</Label>
        <Select :model-value="localModel || 'claude-opus-4-5-20251101'" @update:model-value="handleModelChange">
          <SelectTrigger class="w-full bg-input border-border">
            <SelectValue :placeholder="currentModelDisplayName" />
          </SelectTrigger>
          <SelectContent class="bg-popover border-border">
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
        <Label class="block mb-2 text-primary font-medium">{{ t('settings.budgetLimit') }}</Label>
        <Input
          type="number"
          :model-value="localBudgetLimit ?? ''"
          step="0.1"
          min="0"
          :placeholder="t('settings.budgetPlaceholder')"
          class="bg-input border-border placeholder:text-muted-foreground"
          @change="handleBudgetChange"
        />
        <p class="text-xs text-muted-foreground mt-1">
          {{ t('settings.budgetLimitDescription') }}
        </p>
      </div>

      <!-- Extended Thinking -->
      <div class="mb-5">
        <div class="flex items-center justify-between mb-2">
          <Label for="extended-thinking" class="text-primary font-medium">
            {{ t('settings.extendedThinking') }}
          </Label>
          <Switch
            id="extended-thinking"
            v-model:checked="enableExtendedThinking"
          />
        </div>
        <div v-if="enableExtendedThinking" class="mt-3 flex items-center gap-2">
          <Input
            type="number"
            :model-value="localMaxThinkingTokens ?? 10000"
            :min="1000"
            :max="63999"
            :step="1000"
            class="bg-input border-border text-center"
            @change="handleThinkingTokensChange"
          />
          <span class="text-sm text-muted-foreground whitespace-nowrap">{{ t('common.tokens') }}</span>
        </div>
      </div>

      <!-- Beta Features -->
      <div class="mb-5">
        <Label class="block mb-2 text-foreground font-medium">{{ t('settings.betaFeatures') }}</Label>
        <div class="flex items-center justify-between">
          <Label for="context-1m" class="text-sm font-normal text-foreground" :class="{ 'text-muted-foreground': !modelSupports1MContext }">
            {{ t('settings.beta1mContext') }}
          </Label>
          <Switch
            id="context-1m"
            v-model:checked="is1MContextEnabled"
            :disabled="!modelSupports1MContext"
          />
        </div>
        <p class="text-xs text-muted-foreground mt-1">
          {{ modelSupports1MContext ? t('settings.beta1mContextDescription') : t('settings.extendedThinkingCondition') }}
        </p>
      </div>

      <!-- Language Selection -->
      <div class="mb-5">
        <Label class="block mb-2 text-primary font-medium">{{ t('settings.language') }}</Label>
        <Select :model-value="currentLocale" @update:model-value="handleLanguageChange">
          <SelectTrigger class="w-full bg-input border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent class="bg-popover border-border">
            <SelectItem
              v-for="lang in languageOptions"
              :key="lang.value"
              :value="lang.value"
            >
              {{ lang.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- Divider -->
      <Separator class="my-4 bg-border" />

      <!-- VS Code Settings Link -->
      <Button
        class="w-full"
        @click="emit('openVSCodeSettings')"
      >
        {{ t('settings.openVsCodeSettings') }}
      </Button>

      <!-- Info -->
      <p class="text-xs text-muted-foreground mt-4 text-center">
        {{ t('settings.settingsInfo') }}
      </p>
    </SheetContent>
  </Sheet>
</template>
