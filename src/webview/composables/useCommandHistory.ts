import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useVSCode } from './useVSCode';
import type { ExtensionToWebviewMessage } from '@shared/types';

const MAX_LOCAL_HISTORY_SIZE = 500;

export function useCommandHistory() {
  const { postMessage, onMessage } = useVSCode();

  const history = ref<string[]>([]);
  const historyIndex = ref(-1);
  const originalInput = ref('');
  const isLoading = ref(false);
  const isLoaded = ref(false);
  const hasMore = ref(false);

  const isNavigating = computed(() => historyIndex.value >= 0);
  const currentEntry = computed(() =>
    historyIndex.value >= 0 && historyIndex.value < history.value.length
      ? history.value[historyIndex.value]
      : null
  );

  let pendingNavigate = false;
  let pendingLoadMore = false;

  function handleMessage(message: ExtensionToWebviewMessage) {
    if (message.type === 'commandHistory') {
      if (pendingLoadMore) {
        const existingSet = new Set(history.value);
        const newItems = message.history.filter(item => !existingSet.has(item));
        history.value = [...history.value, ...newItems];
        pendingLoadMore = false;
      } else {
        history.value = message.history;
      }

      hasMore.value = message.hasMore;
      isLoading.value = false;
      isLoaded.value = true;

      if (pendingNavigate && history.value.length > 0) {
        historyIndex.value = 0;
        pendingNavigate = false;
      }
    }
  }

  let cleanup: (() => void) | null = null;

  onMounted(() => {
    cleanup = onMessage(handleMessage);
  });

  onUnmounted(() => {
    cleanup?.();
  });

  function navigateUp() {
    if (!isLoaded.value && !isLoading.value) {
      isLoading.value = true;
      pendingNavigate = true;
      postMessage({ type: 'requestCommandHistory' });
      return;
    }

    if (history.value.length === 0) return;

    if (historyIndex.value === -1) {
      historyIndex.value = 0;
    } else if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++;
    } else if (hasMore.value && !isLoading.value) {
      isLoading.value = true;
      pendingLoadMore = true;
      postMessage({ type: 'requestCommandHistory', offset: history.value.length });
    }
  }

  function navigateDown() {
    if (historyIndex.value > 0) {
      historyIndex.value--;
    } else if (historyIndex.value === 0) {
      historyIndex.value = -1;
    }
  }

  function reset() {
    historyIndex.value = -1;
    originalInput.value = '';
    pendingNavigate = false;
    pendingLoadMore = false;
  }

  function captureOriginal(text: string) {
    if (historyIndex.value === -1) {
      originalInput.value = text;
    }
  }

  function getOriginalInput() {
    return originalInput.value;
  }

  function addEntry(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const filtered = history.value.filter(entry => entry !== trimmed);
    history.value = [trimmed, ...filtered].slice(0, MAX_LOCAL_HISTORY_SIZE);
  }

  return {
    isNavigating,
    isLoading,
    currentEntry,
    navigateUp,
    navigateDown,
    reset,
    captureOriginal,
    getOriginalInput,
    addEntry,
  };
}
