<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, type Component } from 'vue';
import type { PermissionMode } from '@shared/types';
import { Button } from '@/components/ui/button';
import {
  IconPencil,
  IconCheck,
  IconBolt,
  IconClipboard,
  IconPlay,
  IconEye,
  IconCode,
} from '@/components/icons';
import { useCommandHistory } from '@/composables/useCommandHistory';
import { useAtMentionAutocomplete } from '@/composables/useAtMentionAutocomplete';
import { useSlashCommandAutocomplete } from '@/composables/useSlashCommandAutocomplete';
import { useUIStore } from '@/stores/useUIStore';
import AtMentionPopup from './AtMentionPopup.vue';
import SlashCommandPopup from './SlashCommandPopup.vue';

const uiStore = useUIStore();

const MAX_TEXTAREA_HEIGHT = 200;

const props = defineProps<{
  isProcessing: boolean;
  permissionMode: PermissionMode;
  settingsOpen?: boolean;
}>();

const emit = defineEmits<{
  send: [content: string, includeIdeContext: boolean];
  queue: [content: string];
  cancel: [];
  changeMode: [mode: PermissionMode];
}>();

const inputText = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const cardRef = ref<HTMLDivElement | null>(null);

const {
  isOpen: atMentionOpen,
  query: atMentionQuery,
  selectedIndex: atMentionSelectedIndex,
  filteredItems: atMentionItems,
  isLoading: atMentionLoading,
  checkAndUpdateMention,
  handleKeyDown: handleAtMentionKeyDown,
  selectItem: selectAtMentionItem,
  close: closeAtMention,
} = useAtMentionAutocomplete(inputText, textareaRef);

const {
  isOpen: slashCommandOpen,
  query: slashCommandQuery,
  selectedIndex: slashCommandSelectedIndex,
  filteredCommands: slashCommandCommands,
  isLoading: slashCommandLoading,
  checkAndUpdateSlashCommand,
  handleKeyDown: handleSlashCommandKeyDown,
  selectItem: selectSlashCommandItem,
  close: closeSlashCommand,
} = useSlashCommandAutocomplete(inputText, textareaRef);

function adjustTextareaHeight() {
  const textarea = textareaRef.value;
  if (!textarea) return;

  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
}

function isCursorAtStart(textarea: HTMLTextAreaElement): boolean {
  return textarea.selectionStart === 0;
}

function isCursorAtEnd(textarea: HTMLTextAreaElement): boolean {
  return textarea.selectionStart === textarea.value.length;
}

const {
  isNavigating,
  currentEntry,
  shouldRestoreOriginal,
  navigateUp,
  navigateDown,
  reset: resetHistory,
  captureOriginal,
  getOriginalInput,
  clearRestoreFlag,
  addEntry,
} = useCommandHistory();

watch(currentEntry, (entry) => {
  if (entry !== null) {
    inputText.value = entry;
  } else if (shouldRestoreOriginal.value) {
    inputText.value = getOriginalInput();
    clearRestoreFlag();
  }
});

watch(inputText, () => {
  nextTick(adjustTextareaHeight);
});

function focus() {
  textareaRef.value?.focus();
}

function setInput(value: string) {
  inputText.value = value;
  nextTick(() => {
    adjustTextareaHeight();
    textareaRef.value?.focus();
  });
}

defineExpose({ focus, setInput });

const canSend = computed(() => inputText.value.trim().length > 0);

// Permission mode configuration
const modeConfig: Record<PermissionMode, { icon: Component; label: string; shortLabel: string }> = {
  default: { icon: IconPencil, label: 'Ask before edits', shortLabel: 'Ask' },
  acceptEdits: { icon: IconCheck, label: 'Accept edits', shortLabel: 'Accept' },
  bypassPermissions: { icon: IconBolt, label: 'Bypass permissions', shortLabel: 'Bypass' },
  plan: { icon: IconClipboard, label: 'Plan mode', shortLabel: 'Plan' },
};

const modeOrder: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

const currentModeConfig = computed(() => modeConfig[props.permissionMode]);

function cycleMode() {
  const currentIndex = modeOrder.indexOf(props.permissionMode);
  const nextIndex = (currentIndex + 1) % modeOrder.length;
  emit('changeMode', modeOrder[nextIndex]);
}

const ideContextLabel = computed(() => {
  const ctx = uiStore.ideContext;
  if (!ctx) return 'No file';
  if (ctx.type === 'selection' && ctx.lineCount) {
    return `${ctx.lineCount} line${ctx.lineCount > 1 ? 's' : ''}`;
  }
  return ctx.fileName;
});

const ideContextEnabled = computed(() => {
  return !!(uiStore.ideContext && uiStore.ideContextEnabled);
});

const ideContextTooltip = computed(() => {
  const ctx = uiStore.ideContext;
  const action = ideContextEnabled.value ? 'Click to exclude context' : 'Click to include context';
  if (!ctx) return action;
  return `${ctx.filePath}\n\n${action}`;
});

function toggleIdeContext() {
  uiStore.toggleIdeContext();
}

function handleSend() {
  if (!canSend.value) return;
  const message = inputText.value.trim();
  addEntry(message);

  if (props.isProcessing) {
    emit('queue', message);
  } else {
    emit('send', message, ideContextEnabled.value);
  }

  inputText.value = '';
  resetHistory();
}

function handleButtonClick() {
  if (canSend.value) {
    handleSend();
  } else if (props.isProcessing) {
    handleCancel();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (slashCommandOpen.value) {
    if (['ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'].includes(event.key)) {
      const handled = handleSlashCommandKeyDown(event);
      if (handled) {
        event.preventDefault();
        return;
      }
    }
  }

  if (atMentionOpen.value) {
    if (['ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'].includes(event.key)) {
      const handled = handleAtMentionKeyDown(event);
      if (handled) {
        event.preventDefault();
        return;
      }
    }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    handleSend();
    return;
  }

  if (event.key === 'ArrowUp') {
    event.stopPropagation();
    const textarea = textareaRef.value;
    if (textarea && (textarea.value === '' || isCursorAtStart(textarea))) {
      event.preventDefault();
      captureOriginal(inputText.value);
      navigateUp();
    }
    return;
  }

  if (event.key === 'ArrowDown') {
    event.stopPropagation();
    const textarea = textareaRef.value;
    if (isNavigating.value && textarea && isCursorAtEnd(textarea)) {
      event.preventDefault();
      navigateDown();
    }
    return;
  }
}

function handleInput() {
  if (isNavigating.value) {
    resetHistory();
  }
  checkAndUpdateMention();
  checkAndUpdateSlashCommand();
}

function handleCancel() {
  emit('cancel');
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.isProcessing && !props.settingsOpen) {
    event.preventDefault();
    handleCancel();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown);
  adjustTextareaHeight();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});
</script>

<template>
  <div class="shrink-0 bg-card">
    <!-- @ Mention Autocomplete Popup -->
    <AtMentionPopup
      :is-open="atMentionOpen"
      :items="atMentionItems"
      v-model:selected-index="atMentionSelectedIndex"
      :anchor-element="cardRef"
      :query="atMentionQuery"
      :is-loading="atMentionLoading"
      @select="selectAtMentionItem(atMentionItems.indexOf($event))"
      @close="closeAtMention"
    />

    <!-- Slash Command Autocomplete Popup -->
    <SlashCommandPopup
      :is-open="slashCommandOpen"
      :commands="slashCommandCommands"
      v-model:selected-index="slashCommandSelectedIndex"
      :anchor-element="cardRef"
      :query="slashCommandQuery"
      :is-loading="slashCommandLoading"
      @select="selectSlashCommandItem(slashCommandCommands.indexOf($event))"
      @close="closeSlashCommand"
    />

    <!-- Input area -->
    <div class="p-3">
      <div ref="cardRef" class="bg-input rounded-lg border border-border overflow-hidden transition-colors focus-within:border-primary">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          :placeholder="isProcessing ? 'Type to queue next message...' : 'ctrl+esc to focus or unfocus Claude'"
          rows="1"
          class="w-full p-3 bg-transparent text-foreground resize-none overflow-hidden
                 focus:outline-none placeholder:text-muted-foreground"
          :style="{ maxHeight: `${MAX_TEXTAREA_HEIGHT}px` }"
          @keydown="handleKeydown"
          @input="handleInput"
        />

        <!-- Bottom bar inside input -->
        <div class="flex items-center justify-between px-3 py-2 border-t border-border/50 bg-foreground/5">
          <div class="flex items-center gap-3">
            <!-- Mode toggle button -->
            <Button
              variant="ghost"
              size="sm"
              class="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5"
              :disabled="isProcessing"
              @click="cycleMode"
              :title="`Click to change mode. Current: ${currentModeConfig.label}`"
            >
              <component :is="currentModeConfig.icon" :size="12" />
              <span>{{ currentModeConfig.label }}</span>
            </Button>

            <!-- IDE Context toggle -->
            <button
              class="flex items-center gap-1.5 text-xs transition-colors cursor-pointer"
              :class="ideContextEnabled ? 'text-foreground' : 'text-muted-foreground/50'"
              @click="toggleIdeContext"
              :title="ideContextTooltip"
            >
              <component
                :is="uiStore.ideContext?.type === 'selection' ? IconEye : IconCode"
                :size="12"
                :class="ideContextEnabled ? '' : 'opacity-50'"
              />
              <span :class="!ideContextEnabled && uiStore.ideContext ? 'line-through' : ''">
                {{ ideContextLabel }}
              </span>
            </button>
          </div>

          <div class="flex items-center gap-3">
            <!-- Shortcut hint -->
            <span class="text-xs text-muted-foreground">+</span>
            <span class="text-xs text-muted-foreground">/</span>

            <!-- Queue indicator when processing and has input -->
            <span
              v-if="isProcessing && canSend"
              class="text-xs text-foreground"
            >
              Will queue
            </span>

            <!-- Send/Stop button -->
            <Button
              :disabled="!canSend && !isProcessing"
              size="icon"
              class="w-8 h-8 rounded-lg"
              :class="isProcessing && !canSend ? 'bg-destructive hover:bg-destructive/80 border-destructive' : ''"
              @click="handleButtonClick"
            >
              <span v-if="isProcessing && !canSend" class="w-3.5 h-3.5 bg-destructive-foreground rounded" />
              <IconPlay v-else :size="14" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
