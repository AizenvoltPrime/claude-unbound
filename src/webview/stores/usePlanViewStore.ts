import { ref } from 'vue';
import { defineStore } from 'pinia';

export const usePlanViewStore = defineStore('planView', () => {
  const viewingPlan = ref<string | null>(null);
  const viewingPlanPath = ref<string | null>(null);

  function setViewingPlan(content: string, filePath: string): void {
    viewingPlan.value = content;
    viewingPlanPath.value = filePath;
  }

  function closePlanView(): void {
    viewingPlan.value = null;
    viewingPlanPath.value = null;
  }

  function $reset(): void {
    viewingPlan.value = null;
    viewingPlanPath.value = null;
  }

  return {
    viewingPlan,
    viewingPlanPath,
    setViewingPlan,
    closePlanView,
    $reset,
  };
});
