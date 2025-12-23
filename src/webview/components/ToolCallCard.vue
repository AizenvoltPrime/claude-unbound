<script setup lang="ts">
import { computed } from 'vue';
import type { ToolCall } from '@shared/types';

const props = defineProps<{
  toolCall: ToolCall;
}>();

defineEmits<{
  (e: 'interrupt', toolId: string): void;
}>();

const statusIcon = computed(() => {
  switch (props.toolCall.status) {
    case 'pending':
      return '⏳';
    case 'running':
      return '⚙️';
    case 'awaiting_approval':
      return '🔒';
    case 'approved':
      return '✅';
    case 'denied':
      return '❌';
    case 'completed':
      return '✓';
    case 'failed':
      return '⚠️';
    case 'abandoned':
      return '⊘';  // Not executed
    default:
      return '•';
  }
});

const statusClass = computed(() => {
  switch (props.toolCall.status) {
    case 'pending':
      return 'text-yellow-500';
    case 'running':
      return 'text-blue-500 animate-spin-slow';
    case 'awaiting_approval':
      return 'text-amber-500 animate-pulse';
    case 'approved':
    case 'completed':
      return 'text-green-500';
    case 'denied':
    case 'failed':
      return 'text-red-500';
    case 'abandoned':
      return 'text-gray-400';  // Muted - not executed
    default:
      return 'text-gray-500';
  }
});

const isRunning = computed(() => props.toolCall.status === 'running');
const isFailed = computed(() => props.toolCall.status === 'failed');
const isAbandoned = computed(() => props.toolCall.status === 'abandoned');
const isAwaitingApproval = computed(() => props.toolCall.status === 'awaiting_approval');

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
  <div
    class="rounded-lg text-sm overflow-hidden"
    :class="[
      isFailed ? 'border border-red-500/50' :
      isAbandoned ? 'border border-gray-500/50 opacity-60' :
      'border border-unbound-cyan-800/50'
    ]"
  >
    <!-- Header: Task label -->
    <div class="flex items-center gap-2 px-3 py-1.5 bg-unbound-bg-card border-b border-unbound-cyan-900/30">
      <span class="text-unbound-cyan-400 font-medium">Task:</span>
      <span class="text-unbound-text">{{ toolCall.name }}</span>
      <span :class="statusClass" class="ml-1">{{ statusIcon }}</span>

      <!-- Running indicator with interrupt button -->
      <button
        v-if="isRunning"
        class="ml-auto text-xs px-2 py-0.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors"
        @click="$emit('interrupt', toolCall.id)"
        title="Interrupt this tool"
      >
        Stop
      </button>
    </div>

    <!-- Body: Input/Output -->
    <div class="bg-unbound-bg p-3 space-y-2">
      <!-- Input display -->
      <div class="flex items-start gap-2 text-xs">
        <span class="text-unbound-cyan-500 font-medium shrink-0">IN</span>
        <span class="font-mono text-unbound-muted truncate">{{ formatInput(toolCall.input) }}</span>
      </div>

      <!-- Error message for failed tools -->
      <div
        v-if="isFailed && toolCall.errorMessage"
        class="p-2 rounded text-xs bg-red-900/20 text-red-400 border border-red-500/30"
      >
        <strong>Error:</strong> {{ toolCall.errorMessage }}
      </div>

      <!-- Normal result display -->
      <div
        v-else-if="toolCall.result"
        class="text-xs"
      >
        <div class="flex items-start gap-2">
          <span class="text-unbound-cyan-500 font-medium shrink-0">OUT</span>
          <span
            class="font-mono overflow-x-auto"
            :class="toolCall.isError ? 'text-red-400' : 'text-unbound-accent'"
          >
            {{ toolCall.result.slice(0, 200) }}{{ toolCall.result.length > 200 ? '...' : '' }}
          </span>
        </div>
      </div>

      <!-- Awaiting approval indicator -->
      <div
        v-if="isAwaitingApproval"
        class="p-2 rounded text-xs bg-amber-900/20 text-amber-400 border border-amber-500/30 animate-pulse"
      >
        <strong>Awaiting your approval</strong> — Please respond to the dialog
      </div>

      <!-- Abandoned indicator -->
      <div
        v-if="isAbandoned"
        class="p-2 rounded text-xs bg-gray-800/40 text-gray-400 border border-gray-600/30"
      >
        <strong>Not executed</strong> — Claude changed course before running this tool
      </div>

      <!-- Running state progress indicator -->
      <div v-if="isRunning" class="h-0.5 bg-unbound-bg-card rounded overflow-hidden">
        <div class="h-full bg-unbound-cyan-500 animate-progress"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes progress {
  0% {
    transform: translateX(-100%);
    width: 30%;
  }
  50% {
    width: 50%;
  }
  100% {
    transform: translateX(400%);
    width: 30%;
  }
}

.animate-progress {
  animation: progress 1.5s ease-in-out infinite;
}

.animate-spin-slow {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
