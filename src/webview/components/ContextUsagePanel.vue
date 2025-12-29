<script setup lang="ts">
import { computed } from 'vue';
import { IconChartBar, IconChevronDown, IconChevronUp } from '@/components/icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ContextUsageData } from '@shared/types';

const props = defineProps<{
  data: ContextUsageData;
}>();

const percentUsed = computed(() =>
  Math.round((props.data.totalTokens / props.data.maxTokens) * 100)
);

const progressColor = computed(() => {
  const pct = percentUsed.value;
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-yellow-500';
  return 'bg-unbound-cyan-500';
});

const categories = computed(() => [
  { label: 'System prompt', tokens: props.data.breakdown.systemPrompt, color: 'bg-blue-500' },
  { label: 'System tools', tokens: props.data.breakdown.systemTools, color: 'bg-purple-500' },
  { label: 'Custom agents', tokens: props.data.breakdown.customAgents, color: 'bg-pink-500' },
  { label: 'Memory files', tokens: props.data.breakdown.memoryFiles, color: 'bg-green-500' },
  { label: 'Messages', tokens: props.data.breakdown.messages, color: 'bg-cyan-500' },
  { label: 'Free space', tokens: props.data.breakdown.freeSpace, color: 'bg-gray-600', isFree: true },
]);

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

function getPercent(tokens: number): number {
  return Math.round((tokens / props.data.maxTokens) * 1000) / 10;
}
</script>

<template>
  <div class="border border-unbound-cyan-800/50 rounded-lg bg-unbound-bg-card overflow-hidden">
    <div class="px-4 py-3 flex items-center gap-2 border-b border-unbound-cyan-800/30">
      <IconChartBar :size="16" class="text-unbound-cyan-400" />
      <span class="font-medium text-sm">Context Usage</span>
    </div>

    <div class="p-4 space-y-4">
      <div class="text-xs text-unbound-muted">{{ data.model }}</div>

      <div class="space-y-1">
        <div class="relative h-3 bg-unbound-bg-light rounded-full overflow-hidden">
          <div
            :class="['h-full transition-all duration-300', progressColor]"
            :style="{ width: `${percentUsed}%` }"
          />
        </div>
        <div class="flex justify-between text-xs text-unbound-muted">
          <span>{{ formatTokens(data.totalTokens) }} / {{ formatTokens(data.maxTokens) }}</span>
          <span :class="percentUsed >= 90 ? 'text-red-400' : percentUsed >= 70 ? 'text-yellow-400' : ''">
            {{ percentUsed }}%
          </span>
        </div>
      </div>

      <div class="space-y-2">
        <div
          v-for="cat in categories"
          :key="cat.label"
          class="flex items-center gap-3 text-xs"
        >
          <div class="flex items-center gap-1.5 w-28 shrink-0">
            <span :class="['w-2 h-2 rounded-sm', cat.color]" />
            <span :class="cat.isFree ? 'text-unbound-muted' : 'text-unbound-text'">
              {{ cat.label }}
            </span>
          </div>
          <div class="flex-1 h-1.5 bg-unbound-bg-light rounded-full overflow-hidden">
            <div
              :class="['h-full', cat.isFree ? 'bg-gray-700' : cat.color]"
              :style="{ width: `${getPercent(cat.tokens)}%` }"
            />
          </div>
          <span class="w-16 text-right text-unbound-muted tabular-nums">
            {{ formatTokens(cat.tokens) }}
          </span>
          <span class="w-12 text-right text-unbound-muted tabular-nums">
            {{ getPercent(cat.tokens) }}%
          </span>
        </div>
      </div>

      <template v-if="data.details.memoryFiles.length > 0">
        <Collapsible>
          <CollapsibleTrigger class="flex items-center gap-2 text-xs text-unbound-muted hover:text-unbound-text transition-colors group">
            <IconChevronDown :size="12" class="group-data-[state=open]:hidden" />
            <IconChevronUp :size="12" class="hidden group-data-[state=open]:block" />
            <span>Memory files ({{ data.details.memoryFiles.length }})</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mt-2 ml-4 space-y-1">
              <div
                v-for="file in data.details.memoryFiles"
                :key="file.name"
                class="flex justify-between text-xs"
              >
                <span class="text-unbound-muted truncate">{{ file.name }}</span>
                <span class="text-unbound-muted tabular-nums ml-2">{{ formatTokens(file.tokens) }}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>

      <template v-if="data.details.skills.length > 0">
        <Collapsible>
          <CollapsibleTrigger class="flex items-center gap-2 text-xs text-unbound-muted hover:text-unbound-text transition-colors group">
            <IconChevronDown :size="12" class="group-data-[state=open]:hidden" />
            <IconChevronUp :size="12" class="hidden group-data-[state=open]:block" />
            <span>Skills ({{ data.details.skills.length }})</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mt-2 ml-4 space-y-1">
              <div
                v-for="skill in data.details.skills"
                :key="skill.name"
                class="flex justify-between text-xs"
              >
                <span class="text-unbound-muted truncate">{{ skill.name }}</span>
                <span class="text-unbound-muted tabular-nums ml-2">{{ formatTokens(skill.tokens) }}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>

      <template v-if="data.details.customAgents.length > 0">
        <Collapsible>
          <CollapsibleTrigger class="flex items-center gap-2 text-xs text-unbound-muted hover:text-unbound-text transition-colors group">
            <IconChevronDown :size="12" class="group-data-[state=open]:hidden" />
            <IconChevronUp :size="12" class="hidden group-data-[state=open]:block" />
            <span>Custom agents ({{ data.details.customAgents.length }})</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mt-2 ml-4 space-y-1">
              <div
                v-for="agent in data.details.customAgents"
                :key="agent.name"
                class="flex justify-between text-xs"
              >
                <span class="text-unbound-muted truncate">{{ agent.name }}</span>
                <span class="text-unbound-muted tabular-nums ml-2">{{ formatTokens(agent.tokens) }}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>
    </div>
  </div>
</template>
