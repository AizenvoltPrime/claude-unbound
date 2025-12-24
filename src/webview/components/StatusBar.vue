<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from "vue";
import { usePhraseCycler } from "../composables/usePhraseCycler";
import LottieSpinner from "./LottieSpinner.vue";

const props = defineProps<{
  isProcessing: boolean;
  currentToolName?: string;
}>();

const startTime = ref<number | null>(null);
const elapsedSeconds = ref(0);
let timerInterval: ReturnType<typeof setInterval> | null = null;

const { currentPhrase } = usePhraseCycler(() => props.isProcessing);

const formattedTime = computed(() => {
  const s = elapsedSeconds.value;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
});

watch(
  () => props.isProcessing,
  (processing) => {
    if (processing) {
      startTime.value = Date.now();
      elapsedSeconds.value = 0;
      timerInterval = setInterval(() => {
        if (startTime.value) {
          elapsedSeconds.value = Math.floor((Date.now() - startTime.value) / 1000);
        }
      }, 1000);
    } else {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      startTime.value = null;
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
});
</script>

<template>
  <div v-if="isProcessing" class="flex items-center pl-2 pr-4 pt-1 border-t border-unbound-cyan-900/30 bg-unbound-bg-light">
    <LottieSpinner :size="52" class="shrink-0" />
    <span class="flex-1 text-base text-unbound-muted italic truncate">
      {{ currentToolName ? `Running ${currentToolName}...` : currentPhrase }}
    </span>
    <span class="text-sm text-unbound-muted font-mono">
      {{ formattedTime }}
    </span>
  </div>
</template>
