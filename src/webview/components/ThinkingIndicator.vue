<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

const props = defineProps<{
  thinking?: string;
  isStreaming?: boolean;
}>();

const isExpanded = ref(false);

const hasContent = computed(() => Boolean(props.thinking?.trim()));

// Auto-expand while streaming, allow toggle after
watch(() => props.isStreaming, (streaming) => {
  if (streaming && hasContent.value) {
    isExpanded.value = true;
  }
}, { immediate: true });

watch(() => props.thinking, () => {
  if (props.isStreaming && props.thinking) {
    isExpanded.value = true;
  }
});
</script>

<template>
  <Collapsible
    v-if="isStreaming || hasContent"
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
        <span class="italic">Thinking</span>
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
