<script setup lang="ts">
import { computed } from 'vue';
import type { SessionStats } from '@shared/types';
import { IconArrowDown, IconArrowUp, IconChartBar, IconDatabase, IconFile } from '@/components/icons';
import { Button } from '@/components/ui/button';

const props = defineProps<{
  stats: SessionStats;
}>();

const emit = defineEmits<{
  openLog: [];
}>();

const totalContext = computed(() => {
  return props.stats.totalInputTokens + props.stats.cacheCreationTokens + props.stats.cacheReadTokens;
});

const contextPercentage = computed(() => {
  if (props.stats.contextWindowSize === 0) return 0;
  return Math.round((totalContext.value / props.stats.contextWindowSize) * 100);
});

const contextStatusColor = computed(() => {
  if (contextPercentage.value >= 95) return { fill: '#f87171', text: 'text-red-400' };
  if (contextPercentage.value >= 80) return { fill: '#facc15', text: 'text-yellow-400' };
  return { fill: '#4ade80', text: 'text-green-400' };
});

const hasCacheActivity = computed(() => {
  return props.stats.cacheCreationTokens > 0 || props.stats.cacheReadTokens > 0;
});

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}
</script>

<template>
  <div
    class="flex items-center justify-between px-3 pt-1.5 text-sm border-t border-unbound-cyan-900/30 bg-unbound-bg-light"
  >
    <div class="flex items-center gap-3">
      <span
        class="flex items-center gap-1.5"
        title="Context window usage"
      >
        <!-- Status circle indicator -->
        <svg class="w-3 h-3" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6" cy="6" r="5" :fill="contextStatusColor.fill" />
        </svg>
        <span :class="contextStatusColor.text">{{ formatNumber(totalContext) }}/{{ formatNumber(stats.contextWindowSize) }} ({{ contextPercentage }}%)</span>
      </span>

      <span class="flex items-center gap-1.5" title="Session tokens (input / output)">
        <IconChartBar :size="14" class="text-unbound-muted shrink-0" />
        <span class="flex items-center gap-0.5 text-unbound-text">
          {{ formatNumber(stats.totalInputTokens) }}<IconArrowDown :size="10" />
        </span>
        <span class="flex items-center gap-0.5 text-unbound-text">
          {{ formatNumber(stats.totalOutputTokens) }}<IconArrowUp :size="10" />
        </span>
      </span>

      <span
        v-if="hasCacheActivity"
        class="flex items-center gap-1.5"
        title="Cache (write / read)"
      >
        <IconDatabase :size="14" class="text-unbound-muted shrink-0" />
        <span class="flex items-center gap-0.5 text-purple-400">
          {{ formatNumber(stats.cacheCreationTokens) }}<IconArrowUp :size="10" />
        </span>
        <span class="flex items-center gap-0.5 text-cyan-400">
          {{ formatNumber(stats.cacheReadTokens) }}<IconArrowDown :size="10" />
        </span>
      </span>
    </div>

    <div class="flex items-center gap-3">
      <span v-if="stats.numTurns > 0" class="text-unbound-muted" title="Conversation turns">
        {{ stats.numTurns }} turn{{ stats.numTurns !== 1 ? 's' : '' }}
      </span>
      <span class="font-medium text-unbound-cyan-400" title="Session cost">
        {{ formatCost(stats.totalCostUsd) }}
      </span>
      <Button
        variant="ghost"
        class="h-6 w-6 p-0 text-unbound-muted hover:text-unbound-text"
        title="Open session log file"
        @click="emit('openLog')"
      >
        <IconFile :size="14" />
      </Button>
    </div>
  </div>
</template>
