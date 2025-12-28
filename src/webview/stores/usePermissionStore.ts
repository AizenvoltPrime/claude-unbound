import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { PendingPermissionInfo } from '@shared/types';

export const usePermissionStore = defineStore('permission', () => {
  const pendingPermissions = ref<Record<string, PendingPermissionInfo>>({});

  const currentPermission = computed(() => {
    const entries = Object.values(pendingPermissions.value);
    if (entries.length === 0) return null;
    return entries[0];
  });

  const pendingCount = computed(() => Object.keys(pendingPermissions.value).length);

  function addPermission(
    toolUseId: string,
    info: Omit<PendingPermissionInfo, 'toolUseId'>
  ) {
    pendingPermissions.value = {
      ...pendingPermissions.value,
      [toolUseId]: { toolUseId, ...info },
    };
  }

  function removePermission(toolUseId: string) {
    const { [toolUseId]: _, ...rest } = pendingPermissions.value;
    pendingPermissions.value = rest;
  }

  function $reset() {
    pendingPermissions.value = {};
  }

  return {
    pendingPermissions,
    currentPermission,
    pendingCount,
    addPermission,
    removePermission,
    $reset,
  };
});
