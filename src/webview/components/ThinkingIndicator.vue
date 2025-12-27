<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

const props = defineProps<{
  thinking?: string;
  isStreaming?: boolean;
  duration?: number;
}>();

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
    class="text-sm"
  >
    <CollapsibleTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-auto p-0 gap-2 text-unbound-cyan-300 hover:text-unbound-cyan-200 hover:bg-transparent"
        :disabled="!hasContent"
      >
        <!-- Pulsing indicator: pulses while streaming, static when complete -->
        <span
          class="w-2 h-2 rounded-full bg-unbound-cyan-400 shrink-0"
          :class="{ 'animate-pulse': isStreaming }"
        />
        <span class="italic">{{ isStreaming ? 'Thinking' : 'Thought' }}</span>
        <span v-if="isStreaming || displaySeconds > 0" class="text-unbound-muted text-xs tabular-nums">
          {{ displaySeconds }}s
        </span>
        <span v-if="hasContent" class="text-xs transition-transform duration-200" :class="{ 'rotate-90': isExpanded }">
          ▶
        </span>
      </Button>
    </CollapsibleTrigger>

    <CollapsibleContent>
      <div
        v-if="hasContent"
        class="mt-2 ml-4 p-3 rounded-lg bg-unbound-bg-card border border-unbound-cyan-900/30 overflow-hidden max-h-64 overflow-y-auto"
      >
        <pre class="text-xs text-unbound-muted whitespace-pre-wrap font-mono leading-relaxed">{{ thinking }}</pre>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
