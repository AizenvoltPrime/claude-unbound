<script setup lang="ts">
import { ref, computed } from 'vue';
import type { CompactMarker as CompactMarkerType } from '@shared/types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { IconChevronDown, IconChevronUp } from '@/components/icons';
import MarkdownRenderer from './MarkdownRenderer.vue';

const props = defineProps<{
  marker: CompactMarkerType;
}>();

const isExpanded = ref(true);

const hasSummary = computed(() => !!props.marker.summary);

const tokenReduction = computed(() => {
  if (props.marker.postTokens) {
    return `${formatTokenCount(props.marker.preTokens)}→${formatTokenCount(props.marker.postTokens)}`;
  }
  return formatTokenCount(props.marker.preTokens);
});

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}k`;
  }
  return tokens.toString();
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}
</script>

<template>
  <Collapsible v-model:open="isExpanded" :disabled="!hasSummary">
    <!-- Compact boundary indicator line -->
    <div class="flex items-center gap-3 py-2 px-4">
      <div class="flex-1 h-px bg-gradient-to-r from-transparent via-vscode-link/40 to-transparent"></div>
      <span class="text-[10px] text-vscode-link/60 uppercase tracking-widest font-medium">context boundary</span>
      <div class="flex-1 h-px bg-gradient-to-r from-transparent via-vscode-link/40 to-transparent"></div>
    </div>

    <!-- Main compact card -->
    <div class="mx-4 mb-4 relative">
      <!-- Glow effect -->
      <div class="absolute inset-0 rounded-xl bg-vscode-link/5 blur-xl"></div>

      <!-- Card container -->
      <div class="relative rounded-xl border border-vscode-link/30 bg-unbound-bg-card overflow-hidden">
        <!-- Header with gradient border -->
        <CollapsibleTrigger
          :class="[
            'w-full px-4 py-3 flex items-center justify-between',
            'border-b border-vscode-link/20',
            'bg-vscode-link/5',
            hasSummary ? 'cursor-pointer hover:bg-vscode-link/10 transition-all duration-300' : 'cursor-default'
          ]"
        >
          <div class="flex items-center gap-3">
            <!-- Icon -->
            <div class="relative">
              <div class="w-8 h-8 rounded-lg bg-vscode-link/20 flex items-center justify-center border border-vscode-link/30">
                <span class="text-base">🗜️</span>
              </div>
            </div>

            <div class="flex flex-col items-start">
              <span class="text-sm font-semibold text-unbound-text">Context Compacted</span>
              <div class="flex items-center gap-2 mt-0.5">
                <span
                  v-if="marker.trigger === 'auto'"
                  class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-vscode-link/20 text-vscode-link border border-vscode-link/30"
                >
                  AUTO
                </span>
                <span
                  v-else
                  class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-unbound-cyan-500/20 text-unbound-cyan-400 border border-unbound-cyan-500/30"
                >
                  MANUAL
                </span>
                <span class="text-[10px] text-unbound-muted">{{ tokenReduction }} tokens</span>
                <span class="text-[10px] text-unbound-muted">•</span>
                <span class="text-[10px] text-unbound-muted">{{ formatTimestamp(marker.timestamp) }}</span>
              </div>
            </div>
          </div>

          <div v-if="hasSummary" class="flex items-center gap-2">
            <span class="text-xs text-unbound-muted">{{ isExpanded ? 'Collapse' : 'Expand' }} Summary</span>
            <div class="w-6 h-6 rounded-full bg-vscode-link/20 flex items-center justify-center border border-vscode-link/30">
              <component
                :is="isExpanded ? IconChevronUp : IconChevronDown"
                :size="14"
                class="text-vscode-link"
              />
            </div>
          </div>
        </CollapsibleTrigger>

        <!-- Collapsible summary content -->
        <CollapsibleContent v-if="hasSummary">
          <div class="p-4">
            <!-- Summary header -->
            <div class="flex items-center gap-2 mb-3">
              <div class="w-1 h-4 rounded-full bg-vscode-link"></div>
              <span class="text-xs font-semibold text-vscode-link uppercase tracking-wider">Previous Context Summary</span>
            </div>

            <!-- Summary content with styled scrollbar -->
            <div class="pl-3 border-l border-vscode-link/20">
              <div class="text-sm text-unbound-text/90 leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-2 prose-headings:text-unbound-text prose-strong:text-unbound-text prose-code:text-vscode-link prose-code:bg-vscode-link/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded">
                <MarkdownRenderer :content="marker.summary ?? ''" />
              </div>
            </div>
          </div>
        </CollapsibleContent>

        <!-- No summary state -->
        <div v-if="!hasSummary" class="px-4 py-3 text-xs text-unbound-muted italic">
          No summary available for this compaction
        </div>
      </div>
    </div>
  </Collapsible>
</template>
