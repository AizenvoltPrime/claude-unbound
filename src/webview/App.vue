<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import { onKeyStroke, useIntersectionObserver } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import MessageList from './components/MessageList.vue';
import ChatInput from './components/ChatInput.vue';
import SessionStats from './components/SessionStats.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { Toaster } from '@/components/ui/sonner';
import McpStatusIndicator from './components/McpStatusIndicator.vue';
import McpStatusPanel from './components/McpStatusPanel.vue';
import SubagentIndicator from './components/SubagentIndicator.vue';
import SubagentOverlay from './components/SubagentOverlay.vue';
import StatusBar from './components/StatusBar.vue';
import BudgetWarning from './components/BudgetWarning.vue';
import RewindBrowser from './components/RewindBrowser.vue';
import RewindConfirmModal from './components/RewindConfirmModal.vue';
import DeleteSessionModal from './components/DeleteSessionModal.vue';
import PermissionPrompt from './components/PermissionPrompt.vue';
import TodoListCard from './components/TodoListCard.vue';
import { useVSCode } from './composables/useVSCode';
import { useMessageHandler } from './composables/useMessageHandler';
import { useDoubleKeyStroke } from './composables/useDoubleKeyStroke';
import {
  useUIStore,
  useSettingsStore,
  useSessionStore,
  usePermissionStore,
  useStreamingStore,
  useSubagentStore,
} from './stores';
import { Button } from '@/components/ui/button';
import {
  IconGear,
  IconClipboard,
  IconCheck,
  IconXMark,
  IconPencil,
  IconTrash,
  IconChevronUp,
  IconChevronDown,
} from '@/components/icons';
import type {
  ChatMessage,
  StoredSession,
  PermissionMode,
  RewindOption,
} from '@shared/types';

const { postMessage } = useVSCode();

const uiStore = useUIStore();
const {
  isProcessing,
  isAtBottom,
  showSettingsPanel,
  showMcpPanel,
  showSessionPicker,
  currentRunningTool,
  showRewindTypeModal,
  showRewindBrowser,
  rewindHistoryItems,
  rewindHistoryLoading,
  selectedRewindItem,
  pendingRewindMessageId,
  pendingRewindOption,
  renamingSessionId,
  renameInputValue,
  deletingSessionId,
  showDeleteModal,
  todosPanelCollapsed,
} = storeToRefs(uiStore);

const settingsStore = useSettingsStore();
const {
  currentSettings,
  availableModels,
  accountInfo,
  mcpServers,
  budgetWarning,
} = storeToRefs(settingsStore);

const sessionStore = useSessionStore();
const {
  currentSessionId,
  selectedSessionId,
  currentResumedSessionId,
  storedSessions,
  hasMoreSessions,
  nextSessionsOffset,
  loadingMoreSessions,
  hasMoreHistory,
  nextHistoryOffset,
  loadingMoreHistory,
  checkpointMessages,
  compactMarkers,
  sessionStats,
  selectedSession,
  lastAccessedFile,
  currentTodos,
} = storeToRefs(sessionStore);

const permissionStore = usePermissionStore();
const { currentPermission, pendingCount: pendingPermissionCount } = storeToRefs(permissionStore);

const streamingStore = useStreamingStore();
const { messages, streamingMessageId } = storeToRefs(streamingStore);

const subagentStore = useSubagentStore();
const { subagents, expandedSubagent } = storeToRefs(subagentStore);

const messageContainerRef = ref<HTMLElement | null>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);
const renameInputRef = ref<HTMLInputElement | null>(null);
const sessionPickerRef = ref<HTMLElement | null>(null);
const historySentinelRef = ref<HTMLElement | null>(null);

const compactMarkersList = computed(() => compactMarkers.value);

useIntersectionObserver(
  historySentinelRef,
  ([entry]) => {
    if (!entry) return;
    if (entry.isIntersecting && hasMoreHistory.value && !loadingMoreHistory.value && currentResumedSessionId.value) {
      loadMoreHistory();
    }
  },
  { root: messageContainerRef, threshold: 0 }
);

useMessageHandler({
  messageContainerRef,
  chatInputRef,
});

useDoubleKeyStroke('Escape', () => {
  if (!showRewindTypeModal.value &&
      !showRewindBrowser.value &&
      !showSettingsPanel.value &&
      !showMcpPanel.value &&
      !showDeleteModal.value) {
    uiStore.openRewindTypeModal();
  }
});

function handleSendMessage(content: string) {
  const trimmed = content.trim();

  // Intercept UI-only commands that should not go to the SDK
  if (trimmed === '/rewind' || trimmed.startsWith('/rewind ')) {
    uiStore.openRewindTypeModal();
    return;
  }

  postMessage({ type: 'sendMessage', content });
}

function handleQueueMessage(content: string) {
  postMessage({ type: 'queueMessage', content });
}

function handleModeChange(mode: PermissionMode) {
  postMessage({ type: 'setPermissionMode', mode });
  settingsStore.setPermissionMode(mode);
}

function handleCancel() {
  postMessage({ type: 'cancelSession' });
}

function handleResumeSession(sessionId: string) {
  streamingStore.$reset();
  sessionStore.clearSessionData();

  sessionStore.setResumedSession(sessionId);
  sessionStore.setSelectedSession(sessionId);
  postMessage({ type: 'resumeSession', sessionId });
  uiStore.closeSessionPicker();
}

onKeyStroke('Escape', () => {
  if (showSessionPicker.value && !renamingSessionId.value) {
    uiStore.closeSessionPicker();
  }
});

function toggleSessionPicker() {
  uiStore.toggleSessionPicker();
}

function startRenameSession(sessionId: string, currentName: string) {
  uiStore.startRename(sessionId, currentName);
  nextTick(() => {
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  });
}

function submitRenameSession() {
  if (renamingSessionId.value && renameInputValue.value.trim()) {
    postMessage({
      type: 'renameSession',
      sessionId: renamingSessionId.value,
      newName: renameInputValue.value.trim(),
    });
    uiStore.cancelRename();
  }
}

function cancelRenameSession() {
  uiStore.cancelRename();
}

function startDeleteSession(sessionId: string) {
  uiStore.startDelete(sessionId);
}

function cancelDeleteSession() {
  uiStore.cancelDelete();
}

function confirmDeleteSession() {
  if (deletingSessionId.value) {
    postMessage({
      type: 'deleteSession',
      sessionId: deletingSessionId.value,
    });
    uiStore.cancelDelete();
  }
}

function loadMoreHistory() {
  if (!hasMoreHistory.value || loadingMoreHistory.value || !currentResumedSessionId.value) {
    return;
  }

  sessionStore.setLoadingMoreHistory(true);
  postMessage({
    type: 'requestMoreHistory',
    sessionId: currentResumedSessionId.value,
    offset: nextHistoryOffset.value,
  });
}

function handleMessageScroll(event: Event) {
  const container = event.target as HTMLElement;
  if (!container) return;

  const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  uiStore.setIsAtBottom(scrollBottom < 20);
}

function scrollToBottom() {
  const container = messageContainerRef.value;
  if (container) {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }
}

function loadMoreSessions() {
  if (!hasMoreSessions.value || loadingMoreSessions.value) {
    return;
  }

  sessionStore.setLoadingMoreSessions(true);
  postMessage({
    type: 'requestMoreSessions',
    offset: nextSessionsOffset.value,
  });
}

function handleSessionPickerScroll(event: Event) {
  const container = event.target as HTMLElement;
  if (!container) return;

  const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (scrollBottom < 50 && hasMoreSessions.value && !loadingMoreSessions.value) {
    loadMoreSessions();
  }
}

function getSessionDisplayName(session: StoredSession): string {
  return session.customTitle || session.preview;
}

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function handleSetModel(model: string) {
  settingsStore.setModel(model);
  postMessage({ type: 'setModel', model });
}

function handleSetMaxThinkingTokens(tokens: number | null) {
  settingsStore.setMaxThinkingTokens(tokens);
  postMessage({ type: 'setMaxThinkingTokens', tokens });
}

function handleSetBudgetLimit(budgetUsd: number | null) {
  settingsStore.setBudgetLimit(budgetUsd);
  postMessage({ type: 'setBudgetLimit', budgetUsd });
}

function handleToggleBeta(beta: string, enabled: boolean) {
  settingsStore.toggleBeta(beta, enabled);
  postMessage({ type: 'toggleBeta', beta, enabled });
}

function handleSetPermissionMode(mode: PermissionMode) {
  postMessage({ type: 'setPermissionMode', mode });
  settingsStore.setPermissionMode(mode);
}

function handleSetDefaultPermissionMode(mode: PermissionMode) {
  postMessage({ type: 'setDefaultPermissionMode', mode });
  settingsStore.setDefaultPermissionMode(mode);
}

function handleOpenVSCodeSettings() {
  postMessage({ type: 'openSettings' });
}

function handleOpenSessionLog() {
  postMessage({ type: 'openSessionLog' });
}

function handleOpenAgentLog(agentId: string) {
  postMessage({ type: 'openAgentLog', agentId });
}

function handleRefreshMcpStatus() {
  postMessage({ type: 'requestMcpStatus' });
}

function handleRequestRewind(messageId: string) {
  uiStore.requestRewind(messageId);
  uiStore.openRewindTypeModal();
}

function handleTypeSelected(option: RewindOption) {
  if (option === 'cancel') {
    uiStore.cancelRewind();
    uiStore.closeRewindTypeModal();
    return;
  }

  if (pendingRewindMessageId.value) {
    postMessage({ type: 'rewindToMessage', userMessageId: pendingRewindMessageId.value, option });
    uiStore.cancelRewind();
    uiStore.closeRewindTypeModal();
  } else {
    uiStore.selectRewindType(option);
    postMessage({ type: 'requestRewindHistory' });
  }
}

function handleRewindBrowserSelect(item: { messageId: string; content: string; timestamp: number; filesAffected: number; linesChanged?: { added: number; removed: number } }) {
  if (pendingRewindOption.value) {
    postMessage({ type: 'rewindToMessage', userMessageId: item.messageId, option: pendingRewindOption.value });
    uiStore.closeRewindBrowser();
    uiStore.cancelRewind();
  }
}

function handleCloseRewindBrowser() {
  uiStore.closeRewindBrowser();
  uiStore.cancelRewind();
}

function handleCancelRewind() {
  uiStore.cancelRewind();
  uiStore.closeRewindTypeModal();
}

function handlePermissionApproval(toolUseId: string, approved: boolean, options?: { acceptAll?: boolean; customMessage?: string }) {
  streamingStore.updateToolStatus(toolUseId, approved ? 'approved' : 'denied');

  if (options?.acceptAll) {
    handleSetPermissionMode('acceptEdits');
  }

  postMessage({
    type: 'approveEdit',
    toolUseId,
    approved,
    customMessage: options?.customMessage,
  });
  permissionStore.removePermission(toolUseId);
}

function handleInterrupt(_toolId: string) {
  postMessage({ type: 'interrupt' });
}

function handleDismissBudgetWarning() {
  settingsStore.dismissBudgetWarning();
}

const rewindMessagePreview = computed(() => {
  if (!pendingRewindMessageId.value) return '';
  const msg = messages.value.find((m: ChatMessage) => m.id === pendingRewindMessageId.value);
  return msg?.content.slice(0, 100) || '';
});
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 bg-background text-foreground">
    <!-- Header bar with account info and controls -->
    <div class="px-3 py-1.5 text-xs border-b border-border/50 flex items-center gap-2 bg-card">
      <div v-if="accountInfo" class="flex items-center gap-2 text-muted-foreground">
        <span v-if="accountInfo.email">{{ accountInfo.email }}</span>
        <span v-if="accountInfo.subscriptionType" class="px-1.5 py-0.5 rounded bg-primary/20 text-primary">
          {{ accountInfo.subscriptionType }}
        </span>
      </div>

      <div class="flex-1"></div>

      <!-- MCP Status Indicator -->
      <McpStatusIndicator
        :servers="mcpServers"
        @click="uiStore.openMcpPanel()"
      />

      <!-- Settings button -->
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-primary hover:bg-muted hover:text-primary"
        title="Settings"
        @click="uiStore.openSettingsPanel()"
      >
        <IconGear :size="18" />
      </Button>
    </div>

    <!-- Budget Warning Banner -->
    <BudgetWarning
      v-if="budgetWarning"
      :current-spend="budgetWarning.currentSpend"
      :limit="budgetWarning.limit"
      :exceeded="budgetWarning.exceeded"
      @dismiss="handleDismissBudgetWarning"
    />

    <!-- Subagents Indicator (running and recently completed) -->
    <SubagentIndicator :subagents="subagents" @expand="subagentStore.expandSubagent" />

    <!-- Session picker dropdown (select-box style) -->
    <div v-if="storedSessions.length > 0" class="px-3 py-2 border-b border-border/30 bg-card">
      <Button
        variant="outline"
        class="w-full h-auto justify-start text-xs text-primary hover:text-foreground p-2"
        @click="toggleSessionPicker"
      >
        <IconClipboard :size="14" class="shrink-0" />
        <span v-if="selectedSession" class="flex-1 text-left truncate text-foreground">
          {{ getSessionDisplayName(selectedSession) }}
        </span>
        <span v-else class="flex-1 text-left text-muted-foreground">
          Select a session ({{ storedSessions.length }})
        </span>
        <component :is="showSessionPicker ? IconChevronUp : IconChevronDown" :size="12" class="text-muted-foreground shrink-0" />
      </Button>

      <div
        v-if="showSessionPicker"
        ref="sessionPickerRef"
        class="mt-2 space-y-1 max-h-64 overflow-y-auto border border-border/30 rounded bg-background"
        @scroll="handleSessionPickerScroll"
      >
        <div
          v-for="session in storedSessions"
          :key="session.id"
          class="group relative"
        >
          <!-- Rename input mode -->
          <div v-if="renamingSessionId === session.id" class="flex items-center gap-2 p-2 rounded bg-muted">
            <input
              ref="renameInputRef"
              v-model="renameInputValue"
              type="text"
              class="flex-1 px-2 py-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
              placeholder="Enter new name..."
              @keyup.enter="submitRenameSession"
              @keyup.escape="cancelRenameSession"
            />
            <Button size="sm" class="h-6 px-2" @click="submitRenameSession"><IconCheck :size="14" /></Button>
            <Button variant="ghost" size="sm" class="h-6 px-2" @click="cancelRenameSession"><IconXMark :size="14" /></Button>
          </div>
          <!-- Normal display mode -->
          <div v-else class="flex items-center">
            <Button
              variant="ghost"
              class="flex-1 h-auto justify-start text-left p-2 text-xs text-foreground"
              :class="[
                selectedSessionId === session.id
                  ? 'bg-primary/20 border-l-2 border-primary'
                  : ''
              ]"
              @click="handleResumeSession(session.id)"
            >
              <div class="w-full">
                <div class="font-medium truncate flex items-center gap-1">
                  <IconCheck v-if="selectedSessionId === session.id" :size="12" class="text-primary shrink-0" />
                  {{ getSessionDisplayName(session) }}
                </div>
                <div class="text-muted-foreground" :class="{ 'ml-4': selectedSessionId === session.id }">
                  {{ formatSessionTime(session.timestamp) }}
                </div>
              </div>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary hover:bg-muted ml-2"
              title="Rename session"
              @click.stop="startRenameSession(session.id, getSessionDisplayName(session))"
            ><IconPencil :size="12" /></Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/20"
              title="Delete session"
              @click.stop="startDeleteSession(session.id)"
            ><IconTrash :size="12" /></Button>
          </div>
        </div>
        <!-- Load more indicator -->
        <div v-if="hasMoreSessions || loadingMoreSessions" class="text-center py-2">
          <Button
            v-if="!loadingMoreSessions"
            variant="link"
            size="sm"
            class="text-xs text-primary hover:text-foreground flex items-center gap-1"
            @click="loadMoreSessions"
          >
            <IconChevronDown :size="12" /> Load more sessions
          </Button>
          <div v-else class="text-xs text-muted-foreground animate-pulse">
            Loading...
          </div>
        </div>
      </div>
    </div>

    <!-- Message area wrapper (relative positioning for scroll-to-bottom button) -->
    <div class="relative flex-1 min-h-0">
      <div
        ref="messageContainerRef"
        class="h-full overflow-y-auto message-container"
        @scroll="handleMessageScroll"
      >
        <!-- Sentinel for infinite scroll (Intersection Observer target) -->
        <div
          v-if="hasMoreHistory || loadingMoreHistory"
          ref="historySentinelRef"
          class="h-4"
        >
          <div
            v-if="loadingMoreHistory"
            class="text-center py-3 text-xs text-muted-foreground animate-pulse"
          >
            Loading history...
          </div>
        </div>

        <MessageList
          :messages="messages"
          :streaming-message-id="streamingMessageId"
          :compact-markers="compactMarkersList"
          :checkpoint-messages="checkpointMessages"
          :subagents="subagents"
          @rewind="handleRequestRewind"
          @interrupt="handleInterrupt"
          @expand-subagent="subagentStore.expandSubagent"
        />
      </div>

      <!-- Scroll to bottom button (appears when scrolled up from bottom) -->
      <Transition name="fade">
        <Button
          v-if="!isAtBottom"
          variant="default"
          size="icon"
          class="absolute bottom-4 right-8 rounded-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/50 z-10"
          title="Scroll to bottom"
          @click="scrollToBottom"
        >
          <IconChevronDown :size="16" />
        </Button>
      </Transition>
    </div>

    <!-- Persistent Todo List Panel (always visible when todos exist) -->
    <div v-if="currentTodos.length > 0" class="px-3 py-2 border-t border-border/30 bg-card">
      <TodoListCard
        :todos="currentTodos"
        :is-collapsed="todosPanelCollapsed"
        @update:is-collapsed="uiStore.setTodosPanelCollapsed"
      />
    </div>

    <!-- Status Bar with witty phrases (above input) -->
    <StatusBar
      :is-processing="isProcessing"
      :current-tool-name="currentRunningTool ?? undefined"
    />

    <SessionStats :stats="sessionStats" @open-log="handleOpenSessionLog" />

    <!-- Permission Prompt (queue - shows one at a time) -->
    <PermissionPrompt
      v-if="currentPermission"
      :visible="true"
      :tool-use-id="currentPermission.toolUseId"
      :tool-name="currentPermission.toolName"
      :file-path="currentPermission.filePath"
      :original-content="currentPermission.originalContent"
      :proposed-content="currentPermission.proposedContent"
      :command="currentPermission.command"
      :agent-description="currentPermission.agentDescription"
      :queue-position="1"
      :queue-total="pendingPermissionCount"
      @approve="(approved, options) => handlePermissionApproval(currentPermission.toolUseId, approved, options)"
    />

    <ChatInput
      ref="chatInputRef"
      :is-processing="isProcessing"
      :permission-mode="currentSettings.permissionMode"
      :current-file="lastAccessedFile"
      :settings-open="showSettingsPanel"
      @send="handleSendMessage"
      @queue="handleQueueMessage"
      @cancel="handleCancel"
      @change-mode="handleModeChange"
    />

    <!-- Toast notifications (Sonner) -->
    <Toaster position="top-right" :duration="4000" />

    <!-- Settings Panel (overlay) -->
    <SettingsPanel
      :visible="showSettingsPanel"
      :settings="currentSettings"
      :available-models="availableModels"
      @close="uiStore.closeSettingsPanel()"
      @set-model="handleSetModel"
      @set-max-thinking-tokens="handleSetMaxThinkingTokens"
      @set-budget-limit="handleSetBudgetLimit"
      @toggle-beta="handleToggleBeta"
      @set-default-permission-mode="handleSetDefaultPermissionMode"
      @open-v-s-code-settings="handleOpenVSCodeSettings"
    />

    <!-- MCP Status Panel (modal) -->
    <McpStatusPanel
      :visible="showMcpPanel"
      :servers="mcpServers"
      @close="uiStore.closeMcpPanel()"
      @refresh="handleRefreshMcpStatus"
    />

    <!-- Rewind Type Modal (pick rewind type first) -->
    <RewindConfirmModal
      :visible="showRewindTypeModal"
      :message-preview="rewindMessagePreview"
      :files-affected="selectedRewindItem?.filesAffected"
      :lines-changed="selectedRewindItem?.linesChanged"
      @confirm="handleTypeSelected"
      @cancel="handleCancelRewind"
    />

    <!-- Rewind Browser (pick which message to rewind to) -->
    <RewindBrowser
      :is-open="showRewindBrowser"
      :prompts="rewindHistoryItems"
      :is-loading="rewindHistoryLoading"
      @select="handleRewindBrowserSelect"
      @close="handleCloseRewindBrowser"
    />

    <!-- Delete Session Confirmation Modal -->
    <DeleteSessionModal
      :visible="showDeleteModal"
      :session-name="deletingSessionId ? getSessionDisplayName(storedSessions.find(s => s.id === deletingSessionId) || { id: '', timestamp: 0, preview: '' }) : ''"
      @confirm="confirmDeleteSession"
      @cancel="cancelDeleteSession"
    />

    <!-- Subagent Overlay (full-screen) -->
    <SubagentOverlay
      v-if="expandedSubagent"
      :subagent="expandedSubagent"
      :streaming="expandedSubagent ? subagentStore.getSubagentStreaming(expandedSubagent.id) : undefined"
      @close="subagentStore.collapseSubagent"
      @interrupt="handleInterrupt"
      @open-log="handleOpenAgentLog"
    />

  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease-out;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
