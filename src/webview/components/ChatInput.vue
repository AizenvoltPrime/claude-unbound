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
} from '@/components/icons';
import { useCommandHistory } from '@/composables/useCommandHistory';
import { useAtMentionAutocomplete } from '@/composables/useAtMentionAutocomplete';
import { useSlashCommandAutocomplete } from '@/composables/useSlashCommandAutocomplete';
import AtMentionPopup from './AtMentionPopup.vue';
import SlashCommandPopup from './SlashCommandPopup.vue';

const MAX_TEXTAREA_HEIGHT = 200;

const props = defineProps<{
  isProcessing: boolean;
  permissionMode: PermissionMode;
  currentFile?: string;
  settingsOpen?: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
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
  filteredFiles: atMentionFiles,
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

const {
  isNavigating,
  currentEntry,
  navigateUp,
  navigateDown,
  reset: resetHistory,
  captureOriginal,
  getOriginalInput,
  addEntry,
} = useCommandHistory();

watch(currentEntry, (entry) => {
  if (entry !== null) {
    inputText.value = entry;
  } else if (isNavigating.value === false) {
    inputText.value = getOriginalInput();
  }
});

watch(inputText, () => {
  nextTick(adjustTextareaHeight);
});

function focus() {
  textareaRef.value?.focus();
}

defineExpose({ focus });

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

function handleSend() {
  if (!canSend.value) return;
  const message = inputText.value.trim();
  addEntry(message);
  // Send raw message - SDK handles slash command expansion
  emit('send', message);
  inputText.value = '';
  resetHistory();
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
    handleSend();
    return;
  }

  if (event.key === 'ArrowUp') {
    const textarea = textareaRef.value;
    if (textarea) {
      const textBeforeCursor = inputText.value.slice(0, textarea.selectionStart);
      const isOnFirstLine = !textBeforeCursor.includes('\n');
      if (inputText.value === '' || isOnFirstLine) {
        event.preventDefault();
        captureOriginal(inputText.value);
        navigateUp();
      }
    }
    return;
  }

  if (event.key === 'ArrowDown') {
    const textarea = textareaRef.value;
    if (isNavigating.value && textarea) {
      const textAfterCursor = inputText.value.slice(textarea.selectionStart);
      const isOnLastLine = !textAfterCursor.includes('\n');
      if (isOnLastLine) {
        event.preventDefault();
        navigateDown();
      }
    }
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

// Extract filename from path
const displayFile = computed(() => {
  if (!props.currentFile) return null;
  const parts = props.currentFile.split(/[/\\]/);
  return parts[parts.length - 1];
});
</script>

<template>
  <div class="flex-shrink-0 bg-unbound-bg-light">
    <!-- @ Mention Autocomplete Popup -->
    <AtMentionPopup
      :is-open="atMentionOpen"
      :files="atMentionFiles"
      v-model:selected-index="atMentionSelectedIndex"
      :anchor-element="cardRef"
      :query="atMentionQuery"
      :is-loading="atMentionLoading"
      @select="selectAtMentionItem(atMentionFiles.indexOf($event))"
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
      <div ref="cardRef" class="bg-unbound-bg-card rounded-lg border border-unbound-cyan-800/50 overflow-hidden">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          :disabled="isProcessing"
          placeholder="ctrl+esc to focus or unfocus Claude"
          rows="1"
          class="w-full p-3 bg-transparent text-unbound-text resize-none overflow-hidden
                 focus:outline-none placeholder:text-unbound-muted
                 disabled:opacity-50"
          :style="{ maxHeight: `${MAX_TEXTAREA_HEIGHT}px` }"
          @keydown="handleKeydown"
          @input="handleInput"
        />

        <!-- Bottom bar inside input -->
        <div class="flex items-center justify-between px-3 py-2 border-t border-unbound-cyan-900/30">
          <div class="flex items-center gap-3">
            <!-- Mode toggle button -->
            <Button
              variant="ghost"
              size="sm"
              class="h-auto px-2 py-1 text-xs text-unbound-muted hover:text-unbound-cyan-300 flex items-center gap-1.5"
              :disabled="isProcessing"
              @click="cycleMode"
              :title="`Click to change mode. Current: ${currentModeConfig.label}`"
            >
              <component :is="currentModeConfig.icon" :size="12" />
              <span>{{ currentModeConfig.label }}</span>
            </Button>

            <!-- Current file indicator -->
            <div v-if="displayFile" class="flex items-center gap-1.5 text-xs text-unbound-muted">
              <span class="text-unbound-cyan-500">&lt;/&gt;</span>
              <span>{{ displayFile }}</span>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <!-- Shortcut hint -->
            <span class="text-xs text-unbound-muted">+</span>
            <span class="text-xs text-unbound-muted">/</span>

            <!-- Send/Stop button -->
            <Button
              :disabled="!canSend && !isProcessing"
              size="icon"
              class="w-8 h-8 rounded-lg"
              :class="isProcessing ? 'bg-red-500 hover:bg-red-600 border-red-500' : ''"
              @click="isProcessing ? handleCancel() : handleSend()"
            >
              <span v-if="isProcessing" class="w-3.5 h-3.5 bg-white rounded" />
              <IconPlay v-else :size="14" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
