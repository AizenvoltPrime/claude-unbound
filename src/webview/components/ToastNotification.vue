<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';

const TOAST_DURATION_MS = 4000;

interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

const props = defineProps<{
  notification: { id: number; message: string; type: string } | null;
}>();

const toasts = ref<Toast[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let toastId = 0;

// Watch for notification changes using the unique id
watch(() => props.notification?.id, () => {
  if (props.notification) {
    addToast(props.notification.message, props.notification.type as Toast['type']);
  }
});

// Cleanup all timers on unmount
onUnmounted(() => {
  timers.forEach(timer => clearTimeout(timer));
  timers.clear();
});

function addToast(message: string, type: Toast['type'] = 'info') {
  const id = ++toastId;
  toasts.value.push({ id, message, type });

  // Auto-remove after duration, track timer for cleanup
  const timer = setTimeout(() => {
    removeToast(id);
  }, TOAST_DURATION_MS);
  timers.set(id, timer);
}

function removeToast(id: number) {
  const index = toasts.value.findIndex(t => t.id === id);
  if (index !== -1) {
    toasts.value.splice(index, 1);
    // Clean up the timer
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }
}

const typeStyles: Record<Toast['type'], string> = {
  info: 'bg-blue-600',
  success: 'bg-green-600',
  warning: 'bg-yellow-600',
  error: 'bg-red-600',
};

const typeIcons: Record<Toast['type'], string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

defineExpose({ addToast });
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="[
            'flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg text-white text-sm',
            typeStyles[toast.type]
          ]"
        >
          <span>{{ typeIcons[toast.type] }}</span>
          <span class="flex-1">{{ toast.message }}</span>
          <button
            class="opacity-70 hover:opacity-100"
            @click="removeToast(toast.id)"
          >
            ✕
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
