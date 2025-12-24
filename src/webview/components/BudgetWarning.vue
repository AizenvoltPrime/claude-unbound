<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '@/components/ui/button';

const props = defineProps<{
  currentSpend: number;
  limit: number;
  exceeded?: boolean;
}>();

defineEmits<{
  (e: 'dismiss'): void;
}>();

const percentUsed = computed(() => {
  if (props.limit <= 0) return 0;
  return Math.min((props.currentSpend / props.limit) * 100, 100);
});

const progressColor = computed(() => {
  if (props.exceeded) return 'bg-red-500';
  if (percentUsed.value >= 90) return 'bg-red-500';
  if (percentUsed.value >= 80) return 'bg-yellow-500';
  return 'bg-green-500';
});

const bannerClass = computed(() => {
  if (props.exceeded) return 'bg-red-900/30 border-red-600/50';
  return 'bg-yellow-900/30 border-yellow-600/50';
});

const iconEmoji = computed(() => props.exceeded ? '🛑' : '⚠️');
</script>

<template>
  <div
    class="flex items-center gap-3 px-4 py-2 border-b text-sm"
    :class="bannerClass"
  >
    <span class="text-lg">{{ iconEmoji }}</span>

    <div class="flex-1">
      <div v-if="exceeded" class="font-medium text-red-400">
        Budget limit exceeded
      </div>
      <div v-else class="font-medium text-yellow-400">
        Approaching budget limit
      </div>

      <div class="flex items-center gap-3 mt-1">
        <div class="flex-1 max-w-32 h-1.5 rounded-full bg-gray-700 overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-300"
            :class="progressColor"
            :style="{ width: `${percentUsed}%` }"
          ></div>
        </div>
        <span class="text-xs opacity-70">
          ${{ currentSpend.toFixed(2) }} / ${{ limit.toFixed(2) }}
          ({{ percentUsed.toFixed(0) }}%)
        </span>
      </div>
    </div>

    <Button
      variant="ghost"
      size="icon-sm"
      class="opacity-50 hover:opacity-100 h-6 w-6"
      @click="$emit('dismiss')"
      title="Dismiss"
    >
      &times;
    </Button>
  </div>
</template>
