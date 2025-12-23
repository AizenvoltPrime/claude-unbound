<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  visible: boolean;
  toolName?: string;
  filePath?: string;
  originalContent?: string;
  proposedContent?: string;
}>();

const emit = defineEmits<{
  (e: 'approve', approved: boolean, options?: { neverAskAgain?: boolean; customMessage?: string }): void;
}>();

const showCustomInput = ref(false);
const customMessage = ref('');

const fileName = computed(() => {
  if (!props.filePath) return '';
  return props.filePath.split(/[/\\]/).pop() || props.filePath;
});

const isNewFile = computed(() => !props.originalContent);

const lineCountChange = computed(() => {
  const originalLines = (props.originalContent || '').split('\n').length;
  const proposedLines = (props.proposedContent || '').split('\n').length;
  const diff = proposedLines - originalLines;
  if (isNewFile.value) return `${proposedLines} lines`;
  if (diff === 0) return 'No line count change';
  return diff > 0 ? `+${diff} lines` : `${diff} lines`;
});

function handleYes() {
  emit('approve', true);
  resetState();
}

function handleYesNeverAsk() {
  emit('approve', true, { neverAskAgain: true });
  resetState();
}

function handleNo() {
  emit('approve', false);
  resetState();
}

function handleCustom() {
  if (showCustomInput.value && customMessage.value.trim()) {
    emit('approve', false, { customMessage: customMessage.value.trim() });
    resetState();
  } else {
    showCustomInput.value = true;
  }
}

function handleCancel() {
  emit('approve', false);
  resetState();
}

function resetState() {
  showCustomInput.value = false;
  customMessage.value = '';
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        @click.self="handleCancel"
      >
        <div class="bg-unbound-bg-card border border-unbound-cyan-800/50 rounded-lg shadow-xl max-w-lg w-full">
          <!-- Header -->
          <div class="p-4 border-b border-unbound-cyan-900/50">
            <h2 class="font-semibold text-unbound-text flex items-center gap-2">
              <span class="text-lg">{{ toolName === 'Write' ? '📝' : '✏️' }}</span>
              <span>Allow {{ toolName?.toLowerCase() }} to {{ fileName }}?</span>
            </h2>
            <div class="text-xs text-unbound-muted mt-1 truncate">{{ filePath }}</div>
          </div>

          <!-- Content preview -->
          <div class="p-4">
            <div class="flex items-center gap-3 mb-4">
              <div class="flex-1">
                <div
                  class="px-3 py-2 rounded text-sm"
                  :class="isNewFile ? 'bg-green-900/20 border border-green-600/30 text-green-300' : 'bg-unbound-cyan-900/20 border border-unbound-cyan-700/30 text-unbound-cyan-300'"
                >
                  <span v-if="isNewFile">New file: </span>
                  <span v-else>Modifying: </span>
                  <span class="font-medium">{{ lineCountChange }}</span>
                </div>
              </div>
            </div>

            <!-- Custom message input (shown when "Tell Claude" is clicked) -->
            <div v-if="showCustomInput" class="mb-4">
              <label class="block text-sm text-unbound-muted mb-2">Tell Claude what to do instead:</label>
              <textarea
                v-model="customMessage"
                class="w-full px-3 py-2 rounded bg-unbound-bg border border-unbound-cyan-800/50 text-unbound-text text-sm resize-none focus:outline-none focus:border-unbound-cyan-500"
                rows="3"
                placeholder="e.g., Use a different approach, rename the file, add error handling..."
                @keydown.enter.ctrl="handleCustom"
              />
            </div>
          </div>

          <!-- Action buttons -->
          <div class="flex flex-col gap-2 p-4 border-t border-unbound-cyan-900/50">
            <div v-if="!showCustomInput" class="grid grid-cols-2 gap-2">
              <!-- Yes button -->
              <button
                class="px-4 py-2.5 rounded text-sm font-medium transition-colors bg-unbound-cyan-600 text-white hover:bg-unbound-cyan-500"
                @click="handleYes"
              >
                <span class="mr-1">1</span> Yes
              </button>

              <!-- Yes, don't ask again -->
              <button
                class="px-4 py-2.5 rounded text-sm transition-colors bg-unbound-bg border border-unbound-cyan-700/50 text-unbound-cyan-300 hover:bg-unbound-cyan-900/30"
                @click="handleYesNeverAsk"
              >
                <span class="mr-1">2</span> Yes, and don't ask again
              </button>

              <!-- No -->
              <button
                class="px-4 py-2.5 rounded text-sm transition-colors bg-unbound-bg border border-unbound-cyan-700/50 text-unbound-text hover:bg-unbound-cyan-900/30"
                @click="handleNo"
              >
                <span class="mr-1">3</span> No
              </button>

              <!-- Tell Claude -->
              <button
                class="px-4 py-2.5 rounded text-sm transition-colors bg-unbound-bg border border-unbound-cyan-700/50 text-unbound-muted hover:bg-unbound-cyan-900/30"
                @click="handleCustom"
              >
                Tell Claude what to do instead
              </button>
            </div>

            <!-- Custom input action buttons -->
            <div v-else class="flex justify-end gap-2">
              <button
                class="px-4 py-2 rounded text-sm transition-colors hover:bg-unbound-cyan-900/30 text-unbound-muted"
                @click="showCustomInput = false; customMessage = ''"
              >
                Back
              </button>
              <button
                class="px-4 py-2 rounded text-sm font-medium transition-colors bg-unbound-cyan-600 text-white hover:bg-unbound-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="!customMessage.trim()"
                @click="handleCustom"
              >
                Send to Claude
              </button>
            </div>
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
