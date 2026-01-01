import { ref, watch, onUnmounted, type Ref, computed } from "vue";

export interface UseTextStreamingReturn {
  displayedContent: Ref<string>;
}

const CHARS_PER_SECOND = 200;

export function useTextStreaming(fullContent: Ref<string>, isActive: Ref<boolean>): UseTextStreamingReturn {
  const displayedLength = ref(0);
  const animationFrameId = ref<number | null>(null);
  const lastFrameTime = ref<number | null>(null);
  const accumulatedChars = ref(0);

  const displayedContent = computed(() => fullContent.value.slice(0, displayedLength.value));

  const cancelAnimation = () => {
    if (animationFrameId.value !== null) {
      cancelAnimationFrame(animationFrameId.value);
      animationFrameId.value = null;
    }
    lastFrameTime.value = null;
    accumulatedChars.value = 0;
  };

  const animate = (currentTime: number) => {
    if (!isActive.value) {
      displayedLength.value = fullContent.value.length;
      cancelAnimation();
      return;
    }

    if (lastFrameTime.value !== null) {
      const deltaTime = (currentTime - lastFrameTime.value) / 1000;
      accumulatedChars.value += deltaTime * CHARS_PER_SECOND;

      if (accumulatedChars.value >= 1 && displayedLength.value < fullContent.value.length) {
        const charsToAdd = Math.floor(accumulatedChars.value);
        accumulatedChars.value -= charsToAdd;
        displayedLength.value = Math.min(displayedLength.value + charsToAdd, fullContent.value.length);
      }
    }

    lastFrameTime.value = currentTime;
    animationFrameId.value = requestAnimationFrame(animate);
  };

  watch(
    [fullContent, isActive],
    ([content, active], [prevContent]) => {
      if (!active) {
        cancelAnimation();
        displayedLength.value = content.length;
        return;
      }

      if (content.length > (prevContent?.length ?? 0)) {
        if (animationFrameId.value === null) {
          animationFrameId.value = requestAnimationFrame(animate);
        }
      }
    },
    { immediate: true }
  );

  onUnmounted(() => {
    cancelAnimation();
  });

  return {
    displayedContent,
  };
}
