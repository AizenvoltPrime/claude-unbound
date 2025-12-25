<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, type Component } from 'vue';
import type { PermissionMode } from '@shared/types';
import { Button } from '@/components/ui/button';
import {
  IconPencil,
  IconCheck,
  IconBolt,
  IconClipboard,
  IconPlay,
} from '@/components/icons';

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

// Expose focus method for parent components
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
  emit('send', inputText.value.trim());
  inputText.value = '';
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
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
  <div class="flex-shrink-0 bg-unbound-bg-light" style="min-height: 80px;">
    <!-- Input area -->
    <div class="p-3">
      <div class="bg-unbound-bg-card rounded-lg border border-unbound-cyan-800/50 overflow-hidden">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          :disabled="isProcessing"
          placeholder="ctrl+esc to focus or unfocus Claude"
          rows="1"
          class="w-full p-3 bg-transparent text-unbound-text resize-none
                 focus:outline-none placeholder:text-unbound-muted
                 disabled:opacity-50"
          @keydown="handleKeydown"
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
