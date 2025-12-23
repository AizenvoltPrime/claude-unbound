<script setup lang="ts">
import { ref, computed } from 'vue';
import type { PermissionMode } from '@shared/types';

const props = defineProps<{
  isProcessing: boolean;
  permissionMode: PermissionMode;
  currentFile?: string;
}>();

const emit = defineEmits<{
  send: [content: string];
  cancel: [];
  changeMode: [mode: PermissionMode];
}>();

const inputText = ref('');

const canSend = computed(() => inputText.value.trim().length > 0 && !props.isProcessing);

// Permission mode configuration
const modeConfig: Record<PermissionMode, { icon: string; label: string; shortLabel: string }> = {
  default: { icon: '✏', label: 'Ask before edits', shortLabel: 'Ask' },
  acceptEdits: { icon: '✓', label: 'Accept edits', shortLabel: 'Accept' },
  bypassPermissions: { icon: '⚡', label: 'Bypass permissions', shortLabel: 'Bypass' },
  plan: { icon: '📋', label: 'Plan mode', shortLabel: 'Plan' },
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
          v-model="inputText"
          :disabled="isProcessing"
          placeholder="ctrl+esc to focus or unfocus Claude"
          rows="2"
          class="w-full p-3 bg-transparent text-unbound-text resize-none
                 focus:outline-none placeholder:text-unbound-muted
                 disabled:opacity-50"
          @keydown="handleKeydown"
        />

        <!-- Bottom bar inside input -->
        <div class="flex items-center justify-between px-3 py-2 border-t border-unbound-cyan-900/30">
          <div class="flex items-center gap-3">
            <!-- Mode toggle button -->
            <button
              class="flex items-center gap-1.5 text-xs text-unbound-muted hover:text-unbound-cyan-300 transition-colors"
              :disabled="isProcessing"
              @click="cycleMode"
              :title="`Click to change mode. Current: ${currentModeConfig.label}`"
            >
              <span>{{ currentModeConfig.icon }}</span>
              <span>{{ currentModeConfig.label }}</span>
            </button>

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

            <!-- Cancel button -->
            <button
              v-if="isProcessing"
              class="px-2 py-1 rounded text-xs bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors"
              @click="handleCancel"
            >
              Cancel
            </button>

            <!-- Send button -->
            <button
              :disabled="!canSend"
              class="w-8 h-8 rounded-lg flex items-center justify-center
                     bg-unbound-cyan-600 text-white
                     hover:bg-unbound-cyan-500
                     disabled:opacity-30 disabled:cursor-not-allowed
                     transition-colors"
              @click="handleSend"
            >
              <span v-if="isProcessing" class="text-sm">⏳</span>
              <span v-else class="text-lg font-bold">↑</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
