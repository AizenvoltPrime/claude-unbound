<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, type Component } from 'vue';
import type { ActiveSubagent } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { usePhraseCycler } from '../composables/usePhraseCycler';
import { AGENT_PHRASES } from '../data/wittyPhrases';
import {
  IconSearch,
  IconCompass,
  IconClipboard,
  IconRobot,
} from '@/components/icons';

const props = defineProps<{
  agent: ActiveSubagent;
}>();

// Get agent-specific phrases or fall back to general-purpose
const phrases = computed(() =>
  AGENT_PHRASES[props.agent.type] || AGENT_PHRASES['general-purpose']
);

// Each agent badge has its own phrase cycler
const { currentPhrase } = usePhraseCycler(() => true, phrases.value);

// Live timer - updates every second
const elapsedSeconds = ref(0);
let timerInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  // Initialize and start interval
  elapsedSeconds.value = Math.floor((Date.now() - props.agent.startTime) / 1000);
  timerInterval = setInterval(() => {
    elapsedSeconds.value = Math.floor((Date.now() - props.agent.startTime) / 1000);
  }, 1000);
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
    class="bg-blue-600/30 text-blue-300 border-blue-500/30 gap-1.5"
  >
    <component :is="getAgentIcon(agent.type)" :size="14" class="animate-pulse shrink-0" />
    <span class="max-w-40 truncate" :title="currentPhrase">{{ currentPhrase }}</span>
    <span class="opacity-50 font-mono text-[10px]">{{ formattedDuration }}</span>
  </Badge>
</template>
