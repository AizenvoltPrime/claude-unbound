<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconChartBar, IconChevronDown, IconChevronUp } from '@/components/icons';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ContextUsageData } from '@shared/types';

const { t } = useI18n();

const props = defineProps<{
  data: ContextUsageData;
}>();

const percentUsed = computed(() =>
  Math.round((props.data.totalTokens / props.data.maxTokens) * 100)
);

const progressColor = computed(() => {
  const pct = percentUsed.value;
  if (pct >= 90) return 'bg-error';
  if (pct >= 70) return 'bg-warning';
  return 'bg-primary';
});

const categories = computed(() => [
  { label: t('context.breakdown.systemPrompt'), tokens: props.data.breakdown.systemPrompt, color: 'bg-info' },
  { label: t('context.breakdown.systemTools'), tokens: props.data.breakdown.systemTools, color: 'bg-primary' },
  { label: t('context.breakdown.customAgents'), tokens: props.data.breakdown.customAgents, color: 'bg-accent' },
  { label: t('context.breakdown.memoryFiles'), tokens: props.data.breakdown.memoryFiles, color: 'bg-success' },
  { label: t('context.breakdown.messages'), tokens: props.data.breakdown.messages, color: 'bg-primary' },
  { label: t('context.breakdown.freeSpace'), tokens: props.data.breakdown.freeSpace, color: 'bg-muted', isFree: true },
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
  <div class="border border-border rounded-lg bg-muted overflow-hidden">
    <div class="px-4 py-3 flex items-center gap-2 border-b border-border/30">
      <IconChartBar :size="16" class="text-primary" />
      <span class="font-medium text-sm">{{ t('context.title') }}</span>
    </div>

    <div class="p-4 space-y-4">
      <div class="text-xs text-muted-foreground">{{ data.model }}</div>

      <div class="space-y-1">
        <div class="relative h-3 bg-card rounded-full overflow-hidden">
          <div
            :class="['h-full transition-all duration-300', progressColor]"
            :style="{ width: `${percentUsed}%` }"
          />
        </div>
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>{{ formatTokens(data.totalTokens) }} / {{ formatTokens(data.maxTokens) }}</span>
          <span :class="percentUsed >= 90 ? 'text-error' : percentUsed >= 70 ? 'text-warning' : ''">
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
            <span :class="cat.isFree ? 'text-muted-foreground' : 'text-foreground'">
              {{ cat.label }}
            </span>
          </div>
          <div class="flex-1 h-1.5 bg-card rounded-full overflow-hidden">
            <div
              :class="['h-full', cat.isFree ? 'bg-gray-700' : cat.color]"
              :style="{ width: `${getPercent(cat.tokens)}%` }"
            />
          </div>
          <span class="w-16 text-right text-muted-foreground tabular-nums">
            {{ formatTokens(cat.tokens) }}
          </span>
          <span class="w-12 text-right text-muted-foreground tabular-nums">
            {{ getPercent(cat.tokens) }}%
          </span>
        </div>
      </div>

      <template v-if="data.details.memoryFiles.length > 0">
        <Collapsible>
          <CollapsibleTrigger class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group">
            <IconChevronDown :size="12" class="group-data-[state=open]:hidden" />
            <IconChevronUp :size="12" class="hidden group-data-[state=open]:block" />
            <span>{{ t('context.breakdown.memoryFiles') }} ({{ data.details.memoryFiles.length }})</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mt-2 ml-4 space-y-1">
              <div
                v-for="file in data.details.memoryFiles"
                :key="file.name"
                class="flex justify-between text-xs"
              >
                <span class="text-muted-foreground truncate">{{ file.name }}</span>
                <span class="text-muted-foreground tabular-nums ml-2">{{ formatTokens(file.tokens) }}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>

      <template v-if="data.details.skills.length > 0">
        <Collapsible>
          <CollapsibleTrigger class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group">
            <IconChevronDown :size="12" class="group-data-[state=open]:hidden" />
            <IconChevronUp :size="12" class="hidden group-data-[state=open]:block" />
            <span>{{ t('context.breakdown.skills') }} ({{ data.details.skills.length }})</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mt-2 ml-4 space-y-1">
              <div
                v-for="skill in data.details.skills"
                :key="skill.name"
                class="flex justify-between text-xs"
              >
                <span class="text-muted-foreground truncate">{{ skill.name }}</span>
                <span class="text-muted-foreground tabular-nums ml-2">{{ formatTokens(skill.tokens) }}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>

      <template v-if="data.details.customAgents.length > 0">
        <Collapsible>
          <CollapsibleTrigger class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group">
            <IconChevronDown :size="12" class="group-data-[state=open]:hidden" />
            <IconChevronUp :size="12" class="hidden group-data-[state=open]:block" />
            <span>{{ t('context.breakdown.customAgents') }} ({{ data.details.customAgents.length }})</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mt-2 ml-4 space-y-1">
              <div
                v-for="agent in data.details.customAgents"
                :key="agent.name"
                class="flex justify-between text-xs"
              >
                <span class="text-muted-foreground truncate">{{ agent.name }}</span>
                <span class="text-muted-foreground tabular-nums ml-2">{{ formatTokens(agent.tokens) }}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>
    </div>
  </div>
</template>
