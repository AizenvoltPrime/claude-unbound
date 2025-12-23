<script setup lang="ts">
import { computed } from 'vue';
import type { McpServerStatusInfo } from '@shared/types';

const props = defineProps<{
  servers: McpServerStatusInfo[];
}>();

defineEmits<{
  (e: 'click'): void;
}>();

const statusSummary = computed(() => {
  if (props.servers.length === 0) {
    return { icon: '', label: '', color: '' };
  }

  const connected = props.servers.filter(s => s.status === 'connected').length;
  const failed = props.servers.filter(s => s.status === 'failed').length;
  const pending = props.servers.filter(s => s.status === 'pending').length;
  const total = props.servers.length;

  if (pending > 0) {
    return {
      icon: '...',
      label: `MCP: ${connected}/${total} connecting`,
      color: 'text-yellow-500',
    };
  }

  if (failed > 0) {
    return {
      icon: '!',
      label: `MCP: ${connected}/${total} (${failed} failed)`,
      color: 'text-red-500',
    };
  }

  return {
    icon: '✓',
    label: `MCP: ${connected}/${total}`,
    color: 'text-green-500',
  };
});

const hasServers = computed(() => props.servers.length > 0);
</script>

<template>
  <button
    v-if="hasServers"
    class="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-vscode-input-bg transition-colors"
    :title="statusSummary.label"
    @click="$emit('click')"
  >
    <span
      class="w-4 h-4 flex items-center justify-center rounded-full text-[10px] font-bold"
      :class="statusSummary.color"
    >
      {{ statusSummary.icon }}
    </span>
    <span class="hidden sm:inline opacity-70">{{ servers.length }} MCP</span>
  </button>
</template>
