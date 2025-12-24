<script setup lang="ts">
import { Button } from '@/components/ui/button';

defineProps<{
  visible: boolean;
  messagePreview?: string;
}>();

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        @click.self="emit('cancel')"
      >
        <div class="bg-vscode-bg border border-vscode-border rounded-lg shadow-xl max-w-md w-full">
          <div class="p-4 border-b border-vscode-border">
            <h2 class="font-semibold flex items-center gap-2">
              <span>Rewind Files</span>
            </h2>
          </div>

          <div class="p-4">
            <div class="flex items-start gap-3 mb-4">
              <span class="text-2xl">⚠️</span>
              <div>
                <p class="mb-2">
                  This will <strong>revert all file changes</strong> made after this point to their previous state.
                </p>
                <p class="text-sm opacity-70">
                  File checkpoints are stored in memory. This action cannot be undone once the session ends.
                </p>
              </div>
            </div>

            <div v-if="messagePreview" class="p-3 rounded bg-vscode-input-bg text-sm mb-4">
              <div class="text-xs opacity-50 mb-1">Rewind to after:</div>
              <div class="truncate italic">{{ messagePreview }}</div>
            </div>

            <div class="p-3 rounded bg-yellow-900/20 border border-yellow-600/30 text-sm">
              <strong class="text-yellow-400">Note:</strong>
              <span class="opacity-80">
                Only file edits made by Claude will be reverted. Git history and external changes are unaffected.
              </span>
            </div>
          </div>

          <div class="flex justify-end gap-3 p-4 border-t border-vscode-border">
            <Button
              variant="ghost"
              @click="emit('cancel')"
            >
              Cancel
            </Button>
            <Button
              class="bg-yellow-600 hover:bg-yellow-700"
              @click="emit('confirm')"
            >
              Rewind Files
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
