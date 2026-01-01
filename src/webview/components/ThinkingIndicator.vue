<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { IconBrain, IconChevronDown } from '@/components/icons';
import { useTextStreaming } from '@/composables/useTextStreaming';

const props = defineProps<{
  thinking?: string;
  isStreaming?: boolean;
  duration?: number;
}>();

const thinkingRef = computed(() => props.thinking ?? '');
const isStreamingRef = computed(() => props.isStreaming ?? false);
const { displayedContent } = useTextStreaming(thinkingRef, isStreamingRef);

const isExpanded = ref(false);
const elapsedSeconds = ref(0);
let startTime: number | null = null;
let intervalId: number | null = null;

const hasContent = computed(() => Boolean(props.thinking?.trim()));

const displaySeconds = computed(() => {
  if (props.isStreaming) {
    return elapsedSeconds.value;
  }
  return props.duration ?? 0;
});

function startTimer() {
  if (intervalId !== null) return;
  startTime = Date.now();
  elapsedSeconds.value = 0;
  intervalId = window.setInterval(() => {
    if (startTime) {
      elapsedSeconds.value = Math.floor((Date.now() - startTime) / 1000);
    }
  }, 1000);
}

function stopTimer() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    startTime = null;
  }
}

watch(() => props.isStreaming, (streaming) => {
  if (streaming) {
    startTimer();
    if (hasContent.value) {
      isExpanded.value = true;
    }
  } else {
    stopTimer();
  }
}, { immediate: true });

watch(() => props.thinking, () => {
  if (props.isStreaming && props.thinking) {
    isExpanded.value = true;
  }
});

onMounted(() => {
  if (props.isStreaming) {
    startTimer();
  }
});

onUnmounted(() => {
  stopTimer();
});
</script>

<template>
  <Collapsible
    v-if="isStreaming || hasContent || duration"
    v-model:open="isExpanded"
    class="thinking-indicator"
  >
    <CollapsibleTrigger
      :class="[
        'group flex items-center gap-2 py-1 px-2 -mx-2 rounded-md transition-colors',
        hasContent ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default'
      ]"
      :disabled="!hasContent"
    >
      <!-- Brain icon with subtle animation -->
      <div class="relative flex items-center justify-center">
        <IconBrain
          :size="14"
          :class="[
            'text-muted-foreground transition-all',
            isStreaming && 'animate-pulse'
          ]"
        />
      </div>

      <!-- Label and duration -->
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted-foreground">
          {{ isStreaming ? 'Thinking' : 'Thought' }}
        </span>
        <span
          v-if="isStreaming || displaySeconds > 0"
          class="text-xs text-muted-foreground/70 tabular-nums"
        >
          {{ displaySeconds }}s
        </span>
      </div>

      <!-- Chevron indicator -->
      <IconChevronDown
        v-if="hasContent"
        :size="14"
        :class="[
          'text-muted-foreground/60 transition-transform duration-200',
          isExpanded && '-rotate-180'
        ]"
      />
    </CollapsibleTrigger>

    <CollapsibleContent>
      <div
        v-if="hasContent"
        class="mt-2 py-2 px-3 border-l-2 border-border bg-muted/30 rounded-r-md overflow-hidden max-h-64 overflow-y-auto"
      >
        <pre class="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">{{ isStreaming ? displayedContent : thinking }}</pre>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<style scoped>
.thinking-indicator {
  font-size: var(--vscode-font-size, 13px);
}
</style>
