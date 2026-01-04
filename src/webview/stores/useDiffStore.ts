import { ref } from 'vue';
import { defineStore } from 'pinia';

export interface ExpandedDiff {
  filePath: string;
  oldContent: string;
  newContent: string;
  isNewFile: boolean;
}

export const useDiffStore = defineStore('diff', () => {
  const expandedDiff = ref<ExpandedDiff | null>(null);

  function expandDiff(diff: ExpandedDiff): void {
    expandedDiff.value = diff;
  }

  function collapseDiff(): void {
    expandedDiff.value = null;
  }

  function $reset(): void {
    expandedDiff.value = null;
  }

  return {
    expandedDiff,
    expandDiff,
    collapseDiff,
    $reset,
  };
});
