import { ref, onUnmounted } from 'vue';

interface DoubleKeyStrokeOptions {
  threshold?: number;
  preventDefault?: boolean;
}

export function useDoubleKeyStroke(
  key: string,
  callback: () => void,
  options: DoubleKeyStrokeOptions = {}
) {
  const { threshold = 300, preventDefault = true } = options;
  const lastPressTime = ref(0);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== key) return;

    const now = Date.now();
    const timeSinceLastPress = now - lastPressTime.value;

    if (timeSinceLastPress > 0 && timeSinceLastPress < threshold) {
      if (preventDefault) event.preventDefault();
      callback();
      lastPressTime.value = 0;
    } else {
      lastPressTime.value = now;
    }
  }

  window.addEventListener('keydown', handleKeyDown);

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  return {
    reset: () => { lastPressTime.value = 0; }
  };
}
