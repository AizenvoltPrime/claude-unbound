<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, type Component } from 'vue';
import type { SubagentState } from '@shared/types';
import { formatModelDisplayName } from '@shared/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  IconArrowLeft,
  IconClipboard,
  IconSearch,
  IconCompass,
  IconRobot,
  IconCheck,
  IconXCircle,
  IconChevronDown,
  IconFile,
} from '@/components/icons';
import LoadingSpinner from './LoadingSpinner.vue';
import ToolCallCard from './ToolCallCard.vue';
import ThinkingIndicator from './ThinkingIndicator.vue';
import MarkdownRenderer from './MarkdownRenderer.vue';

interface StreamingState {
  content?: string;
  thinking?: string;
  thinkingDuration?: number;
  isThinkingPhase?: boolean;
}

const props = defineProps<{
  subagent: SubagentState;
  streaming?: StreamingState;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'interrupt', toolId: string): void;
  (e: 'openLog', agentId: string): void;
}>();

const isPromptExpanded = ref(false);
const elapsedSeconds = ref(0);
let timerInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  if (props.subagent.status === 'running') {
    updateElapsed();
    timerInterval = setInterval(updateElapsed, 1000);
  } else {
    updateElapsed();
  }
});

onUnmounted(() => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
});

function updateElapsed(): void {
  const endTime = props.subagent.endTime ?? Date.now();
  elapsedSeconds.value = Math.floor((endTime - props.subagent.startTime) / 1000);
}

const formattedDuration = computed(() => {
  const elapsed = elapsedSeconds.value;
  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

const agentIcon = computed((): Component => {
  const icons: Record<string, Component> = {
    'code-reviewer': IconSearch,
    Explore: IconCompass,
    Plan: IconClipboard,
    'general-purpose': IconRobot,
  };
  return icons[props.subagent.agentType] || IconClipboard;
});

const statusBadgeClass = computed(() => {
  switch (props.subagent.status) {
    case 'running':
      return 'bg-blue-600/30 text-blue-300 border-blue-500/30';
    case 'completed':
      return 'bg-green-600/30 text-green-300 border-green-500/30';
    case 'failed':
      return 'bg-red-600/30 text-red-300 border-red-500/30';
    default:
      return 'bg-unbound-cyan-600/30 text-unbound-cyan-300 border-unbound-cyan-500/30';
  }
});

const displayAgentType = computed(() => {
  const typeMap: Record<string, string> = {
    'code-reviewer': 'Code Reviewer',
    Explore: 'Explorer',
    Plan: 'Planner',
    'general-purpose': 'Agent',
    'claude-code-guide': 'Guide',
    'statusline-setup': 'Setup',
  };
  return typeMap[props.subagent.agentType] || props.subagent.agentType;
});

const hasPrompt = computed(() => Boolean(props.subagent.prompt?.trim()));

const hasStreamingContent = computed(() =>
  props.streaming && (props.streaming.content || props.streaming.thinking || props.streaming.isThinkingPhase)
);

const hasResult = computed(() => Boolean(props.subagent.result?.content));

const formattedTokens = computed(() => {
  const tokens = props.subagent.result?.totalTokens;
  if (!tokens) return null;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
});

const formattedToolCount = computed(() => {
  const count = props.subagent.result?.totalToolUseCount;
  if (!count) return null;
  return `${count} tool${count === 1 ? '' : 's'}`;
});

const displayModel = computed(() => formatModelDisplayName(props.subagent.model));

const metadataItems = computed(() => [
  displayAgentType.value,
  formattedDuration.value,
  formattedToolCount.value,
  formattedTokens.value ? `${formattedTokens.value} tokens` : null,
  displayModel.value,
].filter(Boolean));

const hasLogFile = computed(() => Boolean(props.subagent.sdkAgentId));
</script>

<template>
  <div class="absolute inset-0 z-50 flex flex-col bg-unbound-bg overflow-hidden">
    <header class="flex items-center gap-3 px-4 py-3 bg-unbound-bg-card border-b border-unbound-cyan-900/30 shrink-0">
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-unbound-muted hover:text-unbound-text hover:bg-unbound-bg shrink-0"
        @click="$emit('close')"
      >
        <IconArrowLeft :size="18" />
      </Button>

      <component :is="agentIcon" :size="20" class="text-unbound-cyan-400 shrink-0" />

      <div class="flex-1 min-w-0">
        <h2 class="text-sm font-medium text-unbound-text truncate">{{ subagent.description }}</h2>
        <div class="flex items-center gap-1.5 text-xs text-unbound-muted leading-none">
          <template v-for="(item, index) in metadataItems" :key="index">
            <span v-if="index > 0" class="text-unbound-muted/50">•</span>
            <span>{{ item }}</span>
          </template>
        </div>
      </div>

      <Button
        v-if="hasLogFile"
        variant="ghost"
        size="icon-sm"
        class="text-unbound-muted hover:text-unbound-text hover:bg-unbound-bg shrink-0"
        title="Open agent log file"
        @click="$emit('openLog', subagent.sdkAgentId!)"
      >
        <IconFile :size="16" />
      </Button>

      <Badge variant="secondary" :class="statusBadgeClass" class="gap-1.5 shrink-0">
        <LoadingSpinner v-if="subagent.status === 'running'" :size="12" />
        <IconCheck v-else-if="subagent.status === 'completed'" :size="12" />
        <IconXCircle v-else-if="subagent.status === 'failed'" :size="12" />
        <span>{{ subagent.status === 'running' ? 'Running' : subagent.status === 'completed' ? 'Completed' : 'Failed' }}</span>
      </Badge>
    </header>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <Collapsible v-if="hasPrompt" v-model:open="isPromptExpanded">
        <CollapsibleTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-auto py-1 px-2 gap-2 text-unbound-cyan-300 hover:text-unbound-cyan-200 hover:bg-unbound-bg-card"
          >
            <IconChevronDown
              :size="14"
              class="transition-transform duration-200"
              :class="{ '-rotate-90': !isPromptExpanded }"
            />
            <span class="text-sm">View prompt</span>
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div class="mt-2 p-3 rounded-lg bg-unbound-bg-card border border-unbound-cyan-900/30 overflow-hidden max-h-48 overflow-y-auto">
            <pre class="text-xs text-unbound-muted whitespace-pre-wrap font-mono leading-relaxed">{{ subagent.prompt }}</pre>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <ThinkingIndicator
        v-if="hasStreamingContent && (streaming?.thinking || streaming?.isThinkingPhase)"
        :thinking="streaming?.thinking"
        :is-streaming="streaming?.isThinkingPhase"
        :duration="streaming?.thinkingDuration"
      />

      <div v-if="subagent.toolCalls.length > 0" class="space-y-2">
        <ToolCallCard
          v-for="tool in subagent.toolCalls"
          :key="tool.id"
          :tool-call="tool"
          @interrupt="$emit('interrupt', $event)"
        />
      </div>

      <template v-for="message in subagent.messages" :key="message.id">
        <ThinkingIndicator
          v-if="message.thinking || message.thinkingDuration"
          :thinking="message.thinking"
          :duration="message.thinkingDuration"
        />

        <div v-if="message.content" class="pl-2">
          <MarkdownRenderer :content="message.content" />
        </div>
      </template>

      <div v-if="hasStreamingContent && streaming?.content" class="pl-2">
        <MarkdownRenderer :content="streaming.content" class="opacity-80" />
      </div>

      <!-- Agent's final result summary -->
      <div v-if="hasResult" class="mt-4 pt-4 border-t border-unbound-cyan-900/30">
        <div class="flex items-center gap-2 mb-2 text-xs text-unbound-cyan-400 font-medium">
          <IconCheck :size="14" />
          <span>Result</span>
        </div>
        <div class="pl-2">
          <MarkdownRenderer :content="subagent.result!.content" />
        </div>
      </div>

      <div v-if="!hasStreamingContent && !hasResult && subagent.messages.length === 0 && subagent.toolCalls.length === 0" class="text-center text-unbound-muted text-sm py-8">
        <LoadingSpinner v-if="subagent.status === 'running'" :size="24" class="mx-auto mb-2" />
        <p>{{ subagent.status === 'running' ? 'Agent is working...' : 'No activity recorded' }}</p>
      </div>
    </div>
  </div>
</template>
