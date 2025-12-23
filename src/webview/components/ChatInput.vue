<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  isProcessing: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
  cancel: [];
}>();

const inputText = ref('');

const canSend = computed(() => inputText.value.trim().length > 0 && !props.isProcessing);

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
</script>

<template>
  <div class="border-t border-vscode-border p-3">
    <div class="flex gap-2">
      <textarea
        v-model="inputText"
        :disabled="isProcessing"
        placeholder="Ask Claude anything..."
        class="flex-1 min-h-[60px] max-h-[200px] p-2 rounded border resize-none
               bg-vscode-input-bg text-vscode-input-fg border-vscode-input-border
               focus:outline-none focus:border-vscode-button-bg
               disabled:opacity-50"
        @keydown="handleKeydown"
      />
    </div>

    <div class="flex justify-between items-center mt-2">
      <span class="text-xs text-gray-500">
        Press Enter to send, Shift+Enter for new line
      </span>

      <div class="flex gap-2">
        <button
          v-if="isProcessing"
          class="px-3 py-1.5 rounded text-sm
                 bg-red-600 text-white hover:bg-red-700
                 transition-colors"
          @click="handleCancel"
        >
          Cancel
        </button>

        <button
          :disabled="!canSend"
          class="px-3 py-1.5 rounded text-sm
                 bg-vscode-button-bg text-vscode-button-fg
                 hover:bg-vscode-button-hover
                 disabled:opacity-50 disabled:cursor-not-allowed
                 transition-colors"
          @click="handleSend"
        >
          {{ isProcessing ? 'Processing...' : 'Send' }}
        </button>
      </div>
    </div>
  </div>
</template>
