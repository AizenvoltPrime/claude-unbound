<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { IconStop, IconWarning, IconXMark } from '@/components/icons';

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

const progressClass = computed(() => {
  if (props.exceeded) return '[&>div]:bg-red-500';
  if (percentUsed.value >= 90) return '[&>div]:bg-red-500';
  if (percentUsed.value >= 80) return '[&>div]:bg-yellow-500';
  return '[&>div]:bg-green-500';
});

const alertClass = computed(() => {
  if (props.exceeded) return 'bg-red-900/30 border-red-600/50';
  return 'bg-yellow-900/30 border-yellow-600/50';
});

const iconComponent = computed((): Component => props.exceeded ? IconStop : IconWarning);
</script>

<template>
  <Alert
    class="flex items-center gap-3 px-4 py-2 rounded-none border-x-0 border-t-0"
    :class="alertClass"
  >
    <component :is="iconComponent" :size="20" class="shrink-0" />

    <div class="flex-1 min-w-0">
      <AlertTitle v-if="exceeded" class="font-medium text-red-400 mb-0">
        Budget limit exceeded
      </AlertTitle>
      <AlertTitle v-else class="font-medium text-yellow-400 mb-0">
        Approaching budget limit
      </AlertTitle>

      <AlertDescription class="flex items-center gap-3 mt-1">
        <Progress
          :model-value="percentUsed"
          class="flex-1 max-w-32 h-1.5 bg-gray-700"
          :class="progressClass"
        />
        <span class="text-xs opacity-70">
          ${{ currentSpend.toFixed(2) }} / ${{ limit.toFixed(2) }}
          ({{ percentUsed.toFixed(0) }}%)
        </span>
      </AlertDescription>
    </div>

    <Button
      variant="ghost"
      size="icon-sm"
      class="opacity-50 hover:opacity-100 h-6 w-6 shrink-0"
      @click="$emit('dismiss')"
      title="Dismiss"
    >
      <IconXMark :size="12" />
    </Button>
  </Alert>
</template>
