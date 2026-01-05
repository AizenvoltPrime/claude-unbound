import { ref } from 'vue';
import { defineStore } from 'pinia';

export const usePlanViewStore = defineStore('planView', () => {
  const viewingPlan = ref<string | null>(null);

  function setViewingPlan(content: string | null): void {
    viewingPlan.value = content;
  }

  function closePlanView(): void {
    viewingPlan.value = null;
  }

  function $reset(): void {
    viewingPlan.value = null;
  }

  return {
    viewingPlan,
    setViewingPlan,
    closePlanView,
    $reset,
  };
});
