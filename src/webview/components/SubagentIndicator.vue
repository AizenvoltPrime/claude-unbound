<script setup lang="ts">
import { computed } from 'vue';
import type { SubagentState } from '@shared/types';
import AgentBadge from './AgentBadge.vue';

const props = defineProps<{
  subagents: Map<string, SubagentState>;
}>();

defineEmits<{
  (e: 'expand', subagentId: string): void;
}>();

const subagentList = computed(() => Array.from(props.subagents.values()));

const hasSubagents = computed(() => props.subagents.size > 0);

const hasRunningSubagent = computed(() =>
  subagentList.value.some(s => s.status === 'running')
);

const indicatorLabel = computed(() =>
  hasRunningSubagent.value ? 'Active agents:' : 'Recent agents:'
);

const indicatorBgClass = computed(() =>
  hasRunningSubagent.value ? 'bg-blue-900/20' : 'bg-green-900/10'
);
</script>

<template>
  <div
    v-if="hasSubagents"
    :class="['flex items-center gap-2 px-3 py-1.5 text-xs border-b border-unbound-cyan-900/30', indicatorBgClass]"
  >
    <span class="opacity-70 shrink-0">{{ indicatorLabel }}</span>
    <div class="flex items-center gap-2 flex-wrap">
      <AgentBadge
        v-for="subagent in subagentList"
        :key="subagent.id"
        :subagent="subagent"
        @click="$emit('expand', $event)"
      />
    </div>
  </div>
</template>
