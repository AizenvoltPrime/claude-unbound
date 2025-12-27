<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, type Component } from 'vue';
import type { SubagentState } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { usePhraseCycler } from '../composables/usePhraseCycler';
import { AGENT_PHRASES } from '../data/wittyPhrases';
import {
  IconSearch,
  IconCompass,
  IconClipboard,
  IconRobot,
  IconCheck,
  IconXCircle,
} from '@/components/icons';

const props = defineProps<{
  subagent: SubagentState;
}>();

defineEmits<{
  (e: 'click', subagentId: string): void;
}>();

const isRunning = computed(() => props.subagent.status === 'running');
const isCompleted = computed(() => props.subagent.status === 'completed');

const phrases = computed(() =>
  AGENT_PHRASES[props.subagent.agentType] || AGENT_PHRASES['general-purpose']
);

const { currentPhrase } = usePhraseCycler(() => isRunning.value, phrases.value);

const elapsedSeconds = ref(0);
let timerInterval: ReturnType<typeof setInterval> | null = null;

function updateElapsed(): void {
  const endTime = props.subagent.endTime ?? Date.now();
  elapsedSeconds.value = Math.floor((endTime - props.subagent.startTime) / 1000);
}

onMounted(() => {
  updateElapsed();
  if (isRunning.value) {
    timerInterval = setInterval(updateElapsed, 1000);
  }
});

onUnmounted(() => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
});

const formattedDuration = computed(() => {
  const elapsed = elapsedSeconds.value;
  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

const displayText = computed(() =>
  isRunning.value ? currentPhrase.value : props.subagent.description
);

const badgeClass = computed(() => {
  switch (props.subagent.status) {
    case 'running':
      return 'bg-blue-600/30 text-blue-300 border-blue-500/30 hover:bg-blue-600/50';
    case 'completed':
      return 'bg-green-600/30 text-green-300 border-green-500/30 hover:bg-green-600/50';
    case 'failed':
      return 'bg-red-600/30 text-red-300 border-red-500/30 hover:bg-red-600/50';
    case 'cancelled':
      return 'bg-amber-600/30 text-amber-300 border-amber-500/30 hover:bg-amber-600/50';
    default:
      return 'bg-unbound-cyan-600/30 text-unbound-cyan-300 border-unbound-cyan-500/30 hover:bg-unbound-cyan-600/50';
  }
});

function getAgentIcon(type: string): Component {
  const icons: Record<string, Component> = {
    'code-reviewer': IconSearch,
    explorer: IconCompass,
    planner: IconClipboard,
    'general-purpose': IconRobot,
    default: IconRobot,
  };
  return icons[type] || IconRobot;
}
</script>

<template>
  <Badge
    variant="secondary"
    :class="['gap-1.5 cursor-pointer transition-colors', badgeClass]"
    @click="$emit('click', subagent.id)"
  >
    <component
      :is="isRunning ? getAgentIcon(subagent.agentType) : isCompleted ? IconCheck : IconXCircle"
      :size="14"
      :class="{ 'animate-pulse': isRunning }"
      class="shrink-0"
    />
    <span class="max-w-40 truncate" :title="displayText">{{ displayText }}</span>
    <span class="opacity-50 font-mono text-[10px]">{{ formattedDuration }}</span>
  </Badge>
</template>
