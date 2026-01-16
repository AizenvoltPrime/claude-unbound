<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ToolCall } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  IconArrowLeft,
  IconMcp,
  IconCheck,
  IconXCircle,
  IconWarning,
  IconChevronDown,
} from '@/components/icons';
import LoadingSpinner from './LoadingSpinner.vue';
import MarkdownRenderer from './MarkdownRenderer.vue';
import CodeBlock from './CodeBlock.vue';
import { useOverlayEscape } from '@/composables/useOverlayEscape';

const { t } = useI18n();

const RESPONSE_TRUNCATION_THRESHOLD = 2000;

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

const isInputExpanded = ref(true);
const isResponseExpanded = ref(true);
const showFullResponse = ref(false);

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

const hasInput = computed(() => Object.keys(props.tool.input ?? {}).length > 0);

const inputAsJson = computed(() => JSON.stringify(props.tool.input ?? {}, null, 2));

function tryParseJson(str: string): unknown | null {
  const trimmed = str.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

const parsedResponseJson = computed(() => tryParseJson(parsedResult.value));

const responseIsJson = computed(() => parsedResponseJson.value !== null);

const formattedResponse = computed(() => {
  if (parsedResponseJson.value !== null) {
    return JSON.stringify(parsedResponseJson.value, null, 2);
  }
  return parsedResult.value;
});

const shouldTruncateResponse = computed(() =>
  formattedResponse.value.length > RESPONSE_TRUNCATION_THRESHOLD
);

const displayedResponse = computed(() => {
  if (!shouldTruncateResponse.value || showFullResponse.value) {
    return formattedResponse.value;
  }
  return formattedResponse.value.slice(0, RESPONSE_TRUNCATION_THRESHOLD);
});
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

      <div v-else-if="isRunning" class="text-center text-muted-foreground text-sm py-8">
        <LoadingSpinner :size="24" class="mx-auto mb-2" />
        <p>{{ t('mcpToolOverlay.running') }}</p>
      </div>

      <template v-else>
        <!-- Input Section -->
        <Collapsible v-model:open="isInputExpanded">
          <CollapsibleTrigger
            class="group flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md transition-colors cursor-pointer hover:bg-muted/50 w-full"
          >
            <IconChevronDown
              :size="14"
              class="text-muted-foreground transition-transform duration-200"
              :class="{ '-rotate-90': !isInputExpanded }"
            />
            <span class="text-xs font-medium text-muted-foreground">{{ t('mcpToolOverlay.input') }}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mt-2">
              <CodeBlock v-if="hasInput" :code="inputAsJson" language="json" />
              <div v-else class="text-sm text-muted-foreground italic pl-6">
                {{ t('mcpToolOverlay.noInput') }}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <!-- Response Section -->
        <Collapsible v-if="hasResult" v-model:open="isResponseExpanded">
          <CollapsibleTrigger
            class="group flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md transition-colors cursor-pointer hover:bg-muted/50 w-full"
          >
            <IconChevronDown
              :size="14"
              class="text-primary transition-transform duration-200"
              :class="{ '-rotate-90': !isResponseExpanded }"
            />
            <span class="text-xs font-medium text-primary">{{ t('mcpToolOverlay.response') }}</span>
            <IconCheck :size="14" class="text-primary" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mt-2">
              <template v-if="responseIsJson">
                <CodeBlock :code="displayedResponse" language="json" />
              </template>
              <template v-else>
                <div class="pl-2">
                  <MarkdownRenderer :content="displayedResponse" />
                </div>
              </template>

              <div v-if="shouldTruncateResponse" class="mt-3 pl-2">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs text-primary hover:text-primary/80"
                  @click="showFullResponse = !showFullResponse"
                >
                  {{ showFullResponse ? t('mcpToolOverlay.showLessResponse') : t('mcpToolOverlay.showFullResponse') }}
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <!-- No Response State -->
        <div v-else class="text-center text-muted-foreground text-sm py-8">
          <p>{{ t('mcpToolOverlay.noResponse') }}</p>
        </div>
      </template>
    </div>
  </div>
</template>
