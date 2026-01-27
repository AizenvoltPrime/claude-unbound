import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { Task } from "@shared/types/subagents";

export const useTaskStore = defineStore("task", () => {
  const tasks = ref<Task[]>([]);
  const pendingInputs = ref<Map<string, Record<string, unknown>>>(new Map());

  const hasTasks = computed(() => tasks.value.length > 0);
  const hasInProgress = computed(() => tasks.value.some(t => t.status === "in_progress"));
  const completedCount = computed(() => tasks.value.filter(t => t.status === "completed").length);

  function trackToolInput(toolId: string, input: Record<string, unknown>) {
    pendingInputs.value.set(toolId, input);
  }

  function getToolInput(toolId: string): Record<string, unknown> | undefined {
    return pendingInputs.value.get(toolId);
  }

  function clearToolInput(toolId: string) {
    pendingInputs.value.delete(toolId);
  }

  function handleTaskCreate(toolId: string, result: { task: { id: string; subject: string } }) {
    if (!result.task?.id || !result.task?.subject) {
      clearToolInput(toolId);
      return;
    }
    const input = getToolInput(toolId);
    clearToolInput(toolId);

    const newTask: Task = {
      id: result.task.id,
      subject: result.task.subject,
      description: (input?.description as string) || undefined,
      status: "pending",
      activeForm: (input?.activeForm as string) || undefined,
      metadata: (input?.metadata as Record<string, unknown>) || undefined,
    };
    tasks.value = [...tasks.value, newTask];
  }

  function handleTaskUpdate(toolId: string, result: { success: boolean; taskId: string }) {
    if (!result.success) return;

    const input = getToolInput(toolId);
    clearToolInput(toolId);
    if (!input) return;

    const updates: Partial<Task> = {};
    if (input.status) updates.status = input.status as Task["status"];
    if (input.subject) updates.subject = input.subject as string;
    if (input.description) updates.description = input.description as string;
    if (input.activeForm) updates.activeForm = input.activeForm as string;
    if (input.owner) updates.owner = input.owner as string;
    if (input.metadata) updates.metadata = input.metadata as Record<string, unknown>;

    if (input.addBlockedBy) {
      const current = tasks.value.find(t => t.id === result.taskId);
      updates.blockedBy = [...new Set([...(current?.blockedBy || []), ...(input.addBlockedBy as string[])])];
    }
    if (input.addBlocks) {
      const current = tasks.value.find(t => t.id === result.taskId);
      updates.blocks = [...new Set([...(current?.blocks || []), ...(input.addBlocks as string[])])];
    }

    tasks.value = tasks.value.map(t =>
      t.id === result.taskId ? { ...t, ...updates } : t
    );
  }

  function handleTaskList(result: { tasks: Task[] }) {
    tasks.value = (result.tasks || []).filter(t => t.id && t.subject);
  }

  function handleTaskGet(result: { task: Task } | Task) {
    const task = 'task' in result && result.task ? result.task : result as Task;
    if (!task.id || !task.subject) return;
    const exists = tasks.value.some(t => t.id === task.id);
    if (exists) {
      tasks.value = tasks.value.map(t => t.id === task.id ? task : t);
    } else {
      tasks.value = [...tasks.value, task];
    }
  }

  function clearTasks() {
    tasks.value = [];
    pendingInputs.value.clear();
  }

  function $reset() {
    clearTasks();
  }

  return {
    tasks,
    hasTasks,
    hasInProgress,
    completedCount,
    trackToolInput,
    handleTaskCreate,
    handleTaskUpdate,
    handleTaskList,
    handleTaskGet,
    clearTasks,
    $reset,
  };
});
