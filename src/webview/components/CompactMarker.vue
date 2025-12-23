<script setup lang="ts">
import type { CompactMarker as CompactMarkerType } from '@shared/types';

defineProps<{
  marker: CompactMarkerType;
}>();

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}K`;
  }
  return tokens.toString();
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}
</script>

<template>
  <div class="flex items-center gap-3 py-3 px-4">
    <div class="flex-1 border-t border-dashed border-vscode-border"></div>
    <div class="flex items-center gap-2 text-xs opacity-60">
      <span class="text-purple-400">Context compacted</span>
      <span v-if="marker.trigger === 'auto'" class="px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300">
        auto
      </span>
      <span v-else class="px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300">
        manual
      </span>
      <span class="opacity-50">{{ formatTokenCount(marker.preTokens) }} tokens</span>
      <span class="opacity-50">{{ formatTimestamp(marker.timestamp) }}</span>
    </div>
    <div class="flex-1 border-t border-dashed border-vscode-border"></div>
  </div>
</template>
