<script setup lang="ts">
import { computed } from 'vue';
import type { ToolCall } from '@shared/types';

const props = defineProps<{
  toolCall: ToolCall;
}>();

const statusIcon = computed(() => {
  switch (props.toolCall.status) {
    case 'pending':
      return '⏳';
    case 'approved':
      return '✅';
    case 'denied':
      return '❌';
    case 'completed':
      return '✓';
    default:
      return '•';
  }
});

const statusClass = computed(() => {
  switch (props.toolCall.status) {
    case 'pending':
      return 'text-yellow-500';
    case 'approved':
    case 'completed':
      return 'text-green-500';
    case 'denied':
      return 'text-red-500';
    default:
      return 'text-gray-500';
  }
});

const toolIcon = computed(() => {
  const icons: Record<string, string> = {
    Read: '📄',
    Write: '✏️',
    Edit: '📝',
    Bash: '💻',
    Glob: '🔍',
    Grep: '🔎',
    WebFetch: '🌐',
    WebSearch: '🔍',
    LSP: '🔧',
    Task: '📋',
  };
  return icons[props.toolCall.name] || '🔧';
});

function formatInput(input: Record<string, unknown>): string {
  // Show a concise summary of the tool input
  if ('file_path' in input) {
    return input.file_path as string;
  }
  if ('command' in input) {
    const cmd = input.command as string;
    return cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd;
  }
  if ('pattern' in input) {
    return `Pattern: ${input.pattern}`;
  }
  if ('query' in input) {
    return `Query: ${input.query}`;
  }
  if ('url' in input) {
    return input.url as string;
  }
  return JSON.stringify(input).slice(0, 60) + '...';
}
</script>

<template>
  <div class="border border-vscode-border rounded p-2 text-sm">
    <div class="flex items-center gap-2">
      <span>{{ toolIcon }}</span>
      <span class="font-medium">{{ toolCall.name }}</span>
      <span :class="statusClass">{{ statusIcon }}</span>
    </div>

    <div class="mt-1 text-xs opacity-70 font-mono truncate">
      {{ formatInput(toolCall.input) }}
    </div>

    <div
      v-if="toolCall.result"
      class="mt-2 p-2 rounded text-xs font-mono overflow-x-auto"
      :class="toolCall.isError ? 'bg-red-900/20 text-red-400' : 'bg-vscode-input-bg'"
    >
      {{ toolCall.result.slice(0, 200) }}{{ toolCall.result.length > 200 ? '...' : '' }}
    </div>
  </div>
</template>
