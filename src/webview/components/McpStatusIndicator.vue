<script setup lang="ts">
import { computed, type Component } from 'vue';
import type { McpServerStatusInfo } from '@shared/types';
import { Button } from '@/components/ui/button';
import { IconCheck, IconExclamation } from '@/components/icons';

const props = defineProps<{
  servers: McpServerStatusInfo[];
}>();

defineEmits<{
  (e: 'click'): void;
}>();

const statusSummary = computed(() => {
  if (props.servers.length === 0) {
    return { icon: null, label: '', color: '', text: '' };
  }

  const connected = props.servers.filter(s => s.status === 'connected').length;
  const failed = props.servers.filter(s => s.status === 'failed').length;
  const pending = props.servers.filter(s => s.status === 'pending').length;
  const total = props.servers.length;

  if (pending > 0) {
    return {
      icon: null,
      label: `MCP: ${connected}/${total} connecting`,
      color: 'text-warning',
      text: '...',
    };
  }

  if (failed > 0) {
    return {
      icon: IconExclamation,
      label: `MCP: ${connected}/${total} (${failed} failed)`,
      color: 'text-error',
      text: '',
    };
  }

  return {
    icon: IconCheck,
    label: `MCP: ${connected}/${total}`,
    color: 'text-success',
    text: '',
  };
});

const hasServers = computed(() => props.servers.length > 0);
</script>

<template>
  <Button
    v-if="hasServers"
    variant="ghost"
    size="sm"
    class="h-auto py-1 px-2 text-xs hover:bg-muted hover:text-inherit"
    :title="statusSummary.label"
    @click="$emit('click')"
  >
    <span
      class="w-4 h-4 flex items-center justify-center rounded-full"
      :class="statusSummary.color"
    >
      <component v-if="statusSummary.icon" :is="statusSummary.icon" :size="12" />
      <span v-else class="text-[10px] font-bold">{{ statusSummary.text }}</span>
    </span>
    <span class="hidden sm:inline opacity-70">{{ servers.length }} MCP</span>
  </Button>
</template>
