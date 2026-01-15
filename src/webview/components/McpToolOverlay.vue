<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ToolCall } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  IconArrowLeft,
  IconMcp,
  IconCheck,
  IconXCircle,
  IconWarning,
} from '@/components/icons';
import LoadingSpinner from './LoadingSpinner.vue';
import MarkdownRenderer from './MarkdownRenderer.vue';
import { useOverlayEscape } from '@/composables/useOverlayEscape';

const { t } = useI18n();

interface ContentBlock {
  type: string;
  text?: string;
}

const props = defineProps<{
  tool: ToolCall;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

useOverlayEscape(() => emit('close'));

const parsedToolName = computed(() => {
  const name = props.tool.name;
  if (!name.startsWith('mcp__')) {
    return { serverName: '', toolName: name };
  }
  const parts = name.split('__');
  return {
    serverName: parts[1] || '',
    toolName: parts.slice(2).join('__') || name,
  };
});

const parsedResult = computed(() => {
  if (!props.tool.result) return '';

  try {
    const parsed = JSON.parse(props.tool.result);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((block: ContentBlock) => block.type === 'text' && block.text)
        .map((block: ContentBlock) => block.text)
        .join('\n\n');
    }
    return props.tool.result;
  } catch {
    return props.tool.result;
  }
});

const isRunning = computed(() =>
  props.tool.status === 'running' || props.tool.status === 'pending'
);

const isFailed = computed(() => props.tool.status === 'failed');

const isCompleted = computed(() => props.tool.status === 'completed');

const statusBadgeClass = computed(() => {
  switch (props.tool.status) {
    case 'running':
    case 'pending':
      return 'bg-primary/30 text-primary border-primary/30';
    case 'completed':
      return 'bg-success/30 text-success border-success/30';
    case 'failed':
      return 'bg-error/30 text-error border-error/30';
    default:
      return 'bg-muted text-muted-foreground border-muted';
  }
});

const displayStatus = computed(() => {
  const statusMap: Record<string, string> = {
    pending: 'Pending',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    awaiting_approval: 'Awaiting Approval',
    approved: 'Approved',
    denied: 'Denied',
    abandoned: 'Abandoned',
  };
  return statusMap[props.tool.status] || props.tool.status;
});

const hasResult = computed(() => Boolean(parsedResult.value?.trim()));
</script>

<template>
  <div class="absolute inset-0 z-50 flex flex-col bg-background overflow-hidden">
    <header class="flex items-center gap-3 px-4 py-3 bg-muted border-b border-border/30 shrink-0">
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-foreground hover:bg-background shrink-0"
        @click="emit('close')"
      >
        <IconArrowLeft :size="18" />
      </Button>

      <IconMcp :size="20" class="text-primary shrink-0" />

      <div class="flex-1 min-w-0">
        <h2 class="text-sm font-medium text-foreground truncate">{{ parsedToolName.toolName }}</h2>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground leading-none">
          <span>{{ parsedToolName.serverName }}</span>
        </div>
      </div>

      <Badge variant="secondary" :class="statusBadgeClass" class="gap-1.5 shrink-0">
        <LoadingSpinner v-if="isRunning" :size="12" />
        <IconCheck v-else-if="isCompleted" :size="12" />
        <IconXCircle v-else-if="isFailed" :size="12" />
        <IconWarning v-else :size="12" />
        <span>{{ displayStatus }}</span>
      </Badge>
    </header>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-if="isFailed && tool.errorMessage" class="text-error">
        <div class="flex items-center gap-2 mb-2 text-xs font-medium">
          <IconXCircle :size="14" />
          <span>{{ t('common.error') }}</span>
        </div>
        <div class="pl-2 font-mono text-sm">{{ tool.errorMessage }}</div>
      </div>

      <div v-else-if="hasResult">
        <div class="flex items-center gap-2 mb-2 text-xs text-primary font-medium">
          <IconCheck :size="14" />
          <span>{{ t('mcpToolOverlay.response') }}</span>
        </div>
        <div class="pl-2">
          <MarkdownRenderer :content="parsedResult" />
        </div>
      </div>

      <div v-else-if="isRunning" class="text-center text-muted-foreground text-sm py-8">
        <LoadingSpinner :size="24" class="mx-auto mb-2" />
        <p>{{ t('mcpToolOverlay.running') }}</p>
      </div>

      <div v-else class="text-center text-muted-foreground text-sm py-8">
        <p>{{ t('mcpToolOverlay.noResponse') }}</p>
      </div>
    </div>
  </div>
</template>
