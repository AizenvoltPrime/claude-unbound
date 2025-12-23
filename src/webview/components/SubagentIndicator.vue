<script setup lang="ts">
import { computed } from 'vue';
import type { ActiveSubagent } from '@shared/types';

const props = defineProps<{
  subagents: Map<string, ActiveSubagent>;
}>();

const subagentList = computed(() => Array.from(props.subagents.values()));

const hasActiveSubagents = computed(() => props.subagents.size > 0);

function getAgentIcon(type: string): string {
  const icons: Record<string, string> = {
    'code-reviewer': '🔍',
    'explorer': '🗺️',
    'planner': '📋',
    'general-purpose': '🤖',
    'default': '🤖',
  };
  return icons[type] || '🤖';
}

function formatDuration(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
</script>

<template>
  <div
    v-if="hasActiveSubagents"
    class="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-vscode-border bg-blue-900/20"
  >
    <span class="opacity-70">Active agents:</span>
    <div class="flex items-center gap-2">
      <div
        v-for="agent in subagentList"
        :key="agent.id"
        class="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600/30 text-blue-300"
      >
        <span class="animate-pulse">{{ getAgentIcon(agent.type) }}</span>
        <span class="capitalize">{{ agent.type.replace('-', ' ') }}</span>
        <span class="opacity-50 font-mono text-[10px]">{{ formatDuration(agent.startTime) }}</span>
      </div>
    </div>
  </div>
</template>
