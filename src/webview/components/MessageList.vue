<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage } from '@shared/types';
import ToolCallCard from './ToolCallCard.vue';

const props = defineProps<{
  messages: ChatMessage[];
}>();

function formatMarkdown(text: string): string {
  // Basic markdown parsing - could be enhanced with marked library
  let html = text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // Line breaks
    .replace(/\n/g, '<br>');

  return html;
}
</script>

<template>
  <div class="p-4 space-y-4">
    <div v-if="messages.length === 0" class="text-center text-gray-500 py-8">
      <p class="text-lg mb-2">⚡ Welcome to Claude Unbound</p>
      <p class="text-sm">Unleash the full power of Claude AI. Ask anything about your code or let me help you build something new.</p>
    </div>

    <div
      v-for="message in messages"
      :key="message.id"
      :class="[
        'rounded-lg p-3',
        message.role === 'user'
          ? 'bg-vscode-button-bg text-vscode-button-fg ml-8'
          : 'bg-vscode-input-bg mr-8',
      ]"
    >
      <div class="flex items-start gap-2">
        <span class="text-sm font-medium opacity-70">
          {{ message.role === 'user' ? 'You' : 'Claude' }}
        </span>
        <span v-if="message.isPartial" class="text-xs opacity-50">typing...</span>
      </div>

      <div
        class="mt-1 prose prose-sm max-w-none"
        v-html="formatMarkdown(message.content)"
      />

      <div v-if="message.toolCalls?.length" class="mt-3 space-y-2">
        <ToolCallCard
          v-for="tool in message.toolCalls"
          :key="tool.id"
          :tool-call="tool"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.prose :deep(pre) {
  margin: 8px 0;
}

.prose :deep(code) {
  font-size: 0.9em;
}

.prose :deep(a) {
  color: var(--vscode-textLink-foreground);
}
</style>
