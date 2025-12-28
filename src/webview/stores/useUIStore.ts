import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useUIStore = defineStore('ui', () => {
  const isProcessing = ref(false);
  const isAtBottom = ref(true);
  const showSettingsPanel = ref(false);
  const showMcpPanel = ref(false);
  const showSessionPicker = ref(false);
  const currentRunningTool = ref<string | null>(null);
  const pendingRewindMessageId = ref<string | null>(null);
  const renamingSessionId = ref<string | null>(null);
  const renameInputValue = ref('');
  const deletingSessionId = ref<string | null>(null);
  const showDeleteModal = ref(false);

  function setProcessing(value: boolean) {
    isProcessing.value = value;
  }

  function setIsAtBottom(value: boolean) {
    isAtBottom.value = value;
  }

  function setCurrentRunningTool(name: string | null) {
    currentRunningTool.value = name;
  }

  function openSettingsPanel() {
    showSettingsPanel.value = true;
  }

  function closeSettingsPanel() {
    showSettingsPanel.value = false;
  }

  function openMcpPanel() {
    showMcpPanel.value = true;
  }

  function closeMcpPanel() {
    showMcpPanel.value = false;
  }

  function openSessionPicker() {
    showSessionPicker.value = true;
  }

  function toggleSessionPicker() {
    showSessionPicker.value = !showSessionPicker.value;
  }

  function closeSessionPicker() {
    showSessionPicker.value = false;
  }

  function requestRewind(messageId: string) {
    pendingRewindMessageId.value = messageId;
  }

  function cancelRewind() {
    pendingRewindMessageId.value = null;
  }

  function startRename(sessionId: string, currentName: string) {
    renamingSessionId.value = sessionId;
    renameInputValue.value = currentName;
  }

  function cancelRename() {
    renamingSessionId.value = null;
    renameInputValue.value = '';
  }

  function startDelete(sessionId: string) {
    deletingSessionId.value = sessionId;
    showDeleteModal.value = true;
  }

  function cancelDelete() {
    deletingSessionId.value = null;
    showDeleteModal.value = false;
  }

  function $reset() {
    isProcessing.value = false;
    isAtBottom.value = true;
    showSettingsPanel.value = false;
    showMcpPanel.value = false;
    showSessionPicker.value = false;
    currentRunningTool.value = null;
    pendingRewindMessageId.value = null;
    renamingSessionId.value = null;
    renameInputValue.value = '';
    deletingSessionId.value = null;
    showDeleteModal.value = false;
  }

  return {
    isProcessing,
    isAtBottom,
    showSettingsPanel,
    showMcpPanel,
    showSessionPicker,
    currentRunningTool,
    pendingRewindMessageId,
    renamingSessionId,
    renameInputValue,
    deletingSessionId,
    showDeleteModal,
    setProcessing,
    setIsAtBottom,
    setCurrentRunningTool,
    openSettingsPanel,
    closeSettingsPanel,
    openMcpPanel,
    closeMcpPanel,
    openSessionPicker,
    toggleSessionPicker,
    closeSessionPicker,
    requestRewind,
    cancelRewind,
    startRename,
    cancelRename,
    startDelete,
    cancelDelete,
    $reset,
  };
});
