<script setup lang="ts">
import { computed } from 'vue';
import type { SessionStats } from '@shared/types';

const props = defineProps<{
  stats: SessionStats;
}>();

const hasStats = computed(() => {
  return props.stats.totalInputTokens > 0 || props.stats.totalOutputTokens > 0;
});

const totalTokens = computed(() => {
  return props.stats.totalInputTokens + props.stats.totalOutputTokens;
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
    v-if="hasStats"
    class="flex items-center justify-between px-3 py-1.5 text-xs border-t border-unbound-cyan-900/30 bg-unbound-bg-light"
  >
    <div class="flex items-center gap-4">
      <span class="flex items-center gap-1" title="Total tokens used">
        <span class="text-unbound-muted">Tokens:</span>
        <span class="font-medium text-unbound-text">{{ formatNumber(totalTokens) }}</span>
        <span class="text-unbound-muted">({{ formatNumber(stats.totalInputTokens) }} in / {{ formatNumber(stats.totalOutputTokens) }} out)</span>
      </span>
    </div>

    <div class="flex items-center gap-4">
      <span v-if="stats.numTurns > 0" class="text-unbound-muted" title="Conversation turns">
        {{ stats.numTurns }} turn{{ stats.numTurns !== 1 ? 's' : '' }}
      </span>
      <span class="font-medium text-unbound-cyan-400" title="Session cost">
        {{ formatCost(stats.totalCostUsd) }}
      </span>
    </div>
  </div>
</template>
