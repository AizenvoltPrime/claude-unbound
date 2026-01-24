import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { RewindHistoryItem, IdeContextDisplayInfo } from '@shared/types';

export const useUIStore = defineStore('ui', () => {
  const isProcessing = ref(false);
  const isAtBottom = ref(true);
  const showSettingsPanel = ref(false);
  const showMcpPanel = ref(false);
  const showPluginPanel = ref(false);
  const showSessionPicker = ref(false);
  const currentRunningTool = ref<string | null>(null);
  const showRewindTypeModal = ref(false);
  const showRewindBrowser = ref(false);
  const rewindHistoryItems = ref<RewindHistoryItem[]>([]);
  const rewindHistoryLoading = ref(false);
  const selectedRewindItem = ref<RewindHistoryItem | null>(null);
  const renamingSessionId = ref<string | null>(null);
  const renameInputValue = ref('');
  const deletingSessionId = ref<string | null>(null);
  const showDeleteModal = ref(false);
  const tasksPanelCollapsed = ref(false);
  const ideContext = ref<IdeContextDisplayInfo | null>(null);
  const ideContextEnabled = ref(true);

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

  function openMcpPanel(): boolean {
    if (isProcessing.value) return false;
    showMcpPanel.value = true;
    return true;
  }

  function closeMcpPanel() {
    showMcpPanel.value = false;
  }

  function openPluginPanel(): boolean {
    if (isProcessing.value) return false;
    showPluginPanel.value = true;
    return true;
  }

  function closePluginPanel() {
    showPluginPanel.value = false;
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

  function closeRewindTypeModal() {
    showRewindTypeModal.value = false;
  }

  function openRewindBrowser() {
    showRewindBrowser.value = true;
    rewindHistoryLoading.value = true;
  }

  function closeRewindBrowser() {
    showRewindBrowser.value = false;
    rewindHistoryLoading.value = false;
    rewindHistoryItems.value = [];
  }

  function setRewindHistory(items: RewindHistoryItem[]) {
    rewindHistoryItems.value = items;
    rewindHistoryLoading.value = false;
  }

  function selectRewindItem(item: RewindHistoryItem) {
    selectedRewindItem.value = item;
    showRewindBrowser.value = false;
    showRewindTypeModal.value = true;
  }

  function cancelTypeSelection() {
    showRewindTypeModal.value = false;
    showRewindBrowser.value = true;
    selectedRewindItem.value = null;
  }

  function cancelRewind() {
    selectedRewindItem.value = null;
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

  function setTasksPanelCollapsed(collapsed: boolean) {
    tasksPanelCollapsed.value = collapsed;
  }

  function setIdeContext(context: IdeContextDisplayInfo | null) {
    ideContext.value = context;
  }

  function toggleIdeContext() {
    ideContextEnabled.value = !ideContextEnabled.value;
  }

  function $reset() {
    isProcessing.value = false;
    isAtBottom.value = true;
    showSettingsPanel.value = false;
    showMcpPanel.value = false;
    showPluginPanel.value = false;
    showSessionPicker.value = false;
    currentRunningTool.value = null;
    showRewindTypeModal.value = false;
    showRewindBrowser.value = false;
    rewindHistoryItems.value = [];
    rewindHistoryLoading.value = false;
    selectedRewindItem.value = null;
    renamingSessionId.value = null;
    renameInputValue.value = '';
    deletingSessionId.value = null;
    showDeleteModal.value = false;
    tasksPanelCollapsed.value = false;
    ideContext.value = null;
    ideContextEnabled.value = true;
  }

  return {
    isProcessing,
    isAtBottom,
    showSettingsPanel,
    showMcpPanel,
    showPluginPanel,
    showSessionPicker,
    currentRunningTool,
    showRewindTypeModal,
    showRewindBrowser,
    rewindHistoryItems,
    rewindHistoryLoading,
    selectedRewindItem,
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
    openPluginPanel,
    closePluginPanel,
    openSessionPicker,
    toggleSessionPicker,
    closeSessionPicker,
    closeRewindTypeModal,
    openRewindBrowser,
    closeRewindBrowser,
    setRewindHistory,
    selectRewindItem,
    cancelTypeSelection,
    cancelRewind,
    startRename,
    cancelRename,
    startDelete,
    cancelDelete,
    tasksPanelCollapsed,
    setTasksPanelCollapsed,
    ideContext,
    ideContextEnabled,
    setIdeContext,
    toggleIdeContext,
    $reset,
  };
});
