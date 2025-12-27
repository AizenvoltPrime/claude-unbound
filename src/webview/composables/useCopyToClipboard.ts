import { ref } from 'vue';

export function useCopyToClipboard(feedbackDuration = 2000) {
  const hasCopied = ref(false);

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      hasCopied.value = true;

      setTimeout(() => {
        hasCopied.value = false;
      }, feedbackDuration);

      return true;
    } catch {
      return false;
    }
  }

  return {
    hasCopied,
    copyToClipboard,
  };
}
