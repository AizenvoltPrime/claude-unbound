<script setup lang="ts">
import { computed } from 'vue';
import type { ActiveSubagent } from '@shared/types';
import AgentBadge from './AgentBadge.vue';

const props = defineProps<{
  subagents: Map<string, ActiveSubagent>;
}>();

const subagentList = computed(() => Array.from(props.subagents.values()));

const hasActiveSubagents = computed(() => props.subagents.size > 0);
</script>

<template>
  <div
    v-if="hasActiveSubagents"
    class="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-unbound-cyan-900/30 bg-blue-900/20"
  >
    <span class="opacity-70 shrink-0">Active agents:</span>
    <div class="flex items-center gap-2 flex-wrap">
      <AgentBadge
        v-for="agent in subagentList"
        :key="agent.id"
        :agent="agent"
      />
    </div>
  </div>
</template>
