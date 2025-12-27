<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, type Component } from 'vue';
import type { SubagentState } from '@shared/types';
import { formatModelDisplayName } from '@shared/utils';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  IconClipboard,
  IconSearch,
  IconCompass,
  IconRobot,
  IconCheck,
  IconXCircle,
  IconGear,
} from '@/components/icons';
import LoadingSpinner from './LoadingSpinner.vue';

const props = defineProps<{
  subagent: SubagentState;
}>();

defineEmits<{
  (e: 'expand'): void;
}>();

const elapsedSeconds = ref(0);
let timerInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  if (props.subagent.status === 'running') {
    updateElapsed();
    timerInterval = setInterval(updateElapsed, 1000);
  } else {
    updateElapsed();
  }
});

onUnmounted(() => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
});

function updateElapsed(): void {
  const endTime = props.subagent.endTime ?? Date.now();
  elapsedSeconds.value = Math.floor((endTime - props.subagent.startTime) / 1000);
}

const formattedDuration = computed(() => {
  const elapsed = elapsedSeconds.value;
  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

const agentIcon = computed((): Component => {
  const icons: Record<string, Component> = {
    'code-reviewer': IconSearch,
    Explore: IconCompass,
    Plan: IconClipboard,
    'general-purpose': IconRobot,
  };
  return icons[props.subagent.agentType] || IconClipboard;
});

const toolCount = computed(() => props.subagent.toolCalls.length);

const cardClass = computed(() => {
  switch (props.subagent.status) {
    case 'running':
      return 'border-blue-500/50 hover:border-blue-400/70';
    case 'completed':
      return 'border-green-500/50 hover:border-green-400/70';
    case 'failed':
      return 'border-red-500/50 hover:border-red-400/70';
    default:
      return 'border-unbound-cyan-800/50';
  }
});

const statusBadgeClass = computed(() => {
  switch (props.subagent.status) {
    case 'running':
      return 'bg-blue-600/30 text-blue-300 border-blue-500/30';
    case 'completed':
      return 'bg-green-600/30 text-green-300 border-green-500/30';
    case 'failed':
      return 'bg-red-600/30 text-red-300 border-red-500/30';
    default:
      return 'bg-unbound-cyan-600/30 text-unbound-cyan-300 border-unbound-cyan-500/30';
  }
});

const displayAgentType = computed(() => {
  const typeMap: Record<string, string> = {
    'code-reviewer': 'Code Reviewer',
    Explore: 'Explorer',
    Plan: 'Planner',
    'general-purpose': 'Agent',
    'claude-code-guide': 'Guide',
    'statusline-setup': 'Setup',
  };
  return typeMap[props.subagent.agentType] || props.subagent.agentType;
});

const displayModel = computed(() => formatModelDisplayName(props.subagent.model));

const metadataItems = computed(() => [
  `${toolCount.value} tool${toolCount.value !== 1 ? 's' : ''}`,
  formattedDuration.value,
  displayModel.value,
].filter(Boolean));
</script>

<template>
  <Card
    class="text-sm overflow-hidden cursor-pointer transition-colors"
    :class="cardClass"
    @click="$emit('expand')"
  >
    <CardHeader class="flex flex-row items-center gap-2 px-3 py-2 bg-unbound-bg-card border-b border-unbound-cyan-900/30 space-y-0">
      <component :is="agentIcon" :size="18" class="text-unbound-cyan-400 shrink-0" />
      <span class="text-unbound-text font-medium truncate flex-1">{{ subagent.description }}</span>
      <Badge variant="secondary" :class="statusBadgeClass" class="gap-1 shrink-0">
        <component :is="agentIcon" :size="12" />
        <span>{{ displayAgentType }}</span>
      </Badge>
    </CardHeader>

    <CardContent class="bg-unbound-bg px-3 py-2 flex items-center justify-between">
      <div class="flex items-center gap-1.5 text-xs text-unbound-muted leading-none">
        <IconGear :size="12" class="shrink-0" />
        <template v-for="(item, index) in metadataItems" :key="index">
          <span v-if="index > 0" class="text-unbound-muted/50">•</span>
          <span>{{ item }}</span>
        </template>
      </div>

      <div class="flex items-center">
        <LoadingSpinner
          v-if="subagent.status === 'running'"
          :size="14"
          class="text-blue-400"
        />
        <IconCheck
          v-else-if="subagent.status === 'completed'"
          :size="14"
          class="text-green-400"
        />
        <IconXCircle
          v-else-if="subagent.status === 'failed'"
          :size="14"
          class="text-red-400"
        />
      </div>
    </CardContent>
  </Card>
</template>
