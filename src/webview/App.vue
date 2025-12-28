<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import { onKeyStroke } from '@vueuse/core';
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
import RewindConfirmModal from './components/RewindConfirmModal.vue';
import DeleteSessionModal from './components/DeleteSessionModal.vue';
import PermissionPrompt from './components/PermissionPrompt.vue';
import { useVSCode } from './composables/useVSCode';
import { useMessageHandler } from './composables/useMessageHandler';
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
  pendingRewindMessageId,
  renamingSessionId,
  renameInputValue,
  deletingSessionId,
  showDeleteModal,
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
} = storeToRefs(sessionStore);

const permissionStore = usePermissionStore();
const { currentPermission, pendingCount: pendingPermissionCount } = storeToRefs(permissionStore);

const streamingStore = useStreamingStore();
const { messages, streamingMessage } = storeToRefs(streamingStore);

const subagentStore = useSubagentStore();
const { subagents, expandedSubagent } = storeToRefs(subagentStore);

const messageContainerRef = ref<HTMLElement | null>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);
const renameInputRef = ref<HTMLInputElement | null>(null);
const sessionPickerRef = ref<HTMLElement | null>(null);

const compactMarkersList = computed(() => compactMarkers.value);

useMessageHandler({
  messageContainerRef,
  chatInputRef,
});

function handleSendMessage(content: string) {
  postMessage({ type: 'sendMessage', content });
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

  if (container.scrollTop < 100 && hasMoreHistory.value && !loadingMoreHistory.value) {
    loadMoreHistory();
  }

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
}

function handleConfirmRewind() {
  if (pendingRewindMessageId.value) {
    postMessage({ type: 'rewindToMessage', userMessageId: pendingRewindMessageId.value });
    uiStore.cancelRewind();
  }
}

function handleCancelRewind() {
  uiStore.cancelRewind();
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
  <div class="flex flex-col flex-1 min-h-0 bg-unbound-bg text-unbound-text">
    <!-- Header bar with account info and controls -->
    <div class="px-3 py-1.5 text-xs border-b border-unbound-cyan-900/50 flex items-center gap-2 bg-unbound-bg-light">
      <div v-if="accountInfo" class="flex items-center gap-2 text-unbound-muted">
        <span v-if="accountInfo.email">{{ accountInfo.email }}</span>
        <span v-if="accountInfo.subscriptionType" class="px-1.5 py-0.5 rounded bg-unbound-cyan-900/50 text-unbound-cyan-300">
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
        class="text-unbound-cyan-400 hover:bg-unbound-cyan-900/30"
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
    <div v-if="storedSessions.length > 0" class="px-3 py-2 border-b border-unbound-cyan-900/30 bg-unbound-bg-light">
      <Button
        variant="outline"
        class="w-full h-auto justify-start text-xs text-unbound-cyan-400 hover:text-unbound-glow p-2"
        @click="toggleSessionPicker"
      >
        <IconClipboard :size="14" class="shrink-0" />
        <span v-if="selectedSession" class="flex-1 text-left truncate text-unbound-text">
          {{ getSessionDisplayName(selectedSession) }}
        </span>
        <span v-else class="flex-1 text-left text-unbound-muted">
          Select a session ({{ storedSessions.length }})
        </span>
        <component :is="showSessionPicker ? IconChevronUp : IconChevronDown" :size="12" class="text-unbound-muted shrink-0" />
      </Button>

      <div
        v-if="showSessionPicker"
        ref="sessionPickerRef"
        class="mt-2 space-y-1 max-h-64 overflow-y-auto border border-unbound-cyan-800/30 rounded bg-unbound-bg"
        @scroll="handleSessionPickerScroll"
      >
        <div
          v-for="session in storedSessions"
          :key="session.id"
          class="group relative"
        >
          <!-- Rename input mode -->
          <div v-if="renamingSessionId === session.id" class="flex items-center gap-2 p-2 rounded bg-unbound-bg-card">
            <input
              ref="renameInputRef"
              v-model="renameInputValue"
              type="text"
              class="flex-1 px-2 py-1 text-xs bg-unbound-bg border border-unbound-cyan-700 rounded text-unbound-text focus:outline-none focus:border-unbound-cyan-500"
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
              class="flex-1 h-auto justify-start text-left p-2 text-xs text-unbound-text"
              :class="[
                selectedSessionId === session.id
                  ? 'bg-unbound-cyan-900/50 border-l-2 border-unbound-cyan-400'
                  : ''
              ]"
              @click="handleResumeSession(session.id)"
            >
              <div class="w-full">
                <div class="font-medium truncate flex items-center gap-1">
                  <IconCheck v-if="selectedSessionId === session.id" :size="12" class="text-unbound-cyan-400 shrink-0" />
                  {{ getSessionDisplayName(session) }}
                </div>
                <div class="text-unbound-muted" :class="{ 'ml-4': selectedSessionId === session.id }">
                  {{ formatSessionTime(session.timestamp) }}
                </div>
              </div>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="opacity-0 group-hover:opacity-100 text-unbound-muted hover:text-unbound-cyan-400"
              title="Rename session"
              @click.stop="startRenameSession(session.id, getSessionDisplayName(session))"
            ><IconPencil :size="12" /></Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="opacity-0 group-hover:opacity-100 text-unbound-muted hover:text-red-400"
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
            class="text-xs text-unbound-cyan-400 hover:text-unbound-glow flex items-center gap-1"
            @click="loadMoreSessions"
          >
            <IconChevronDown :size="12" /> Load more sessions
          </Button>
          <div v-else class="text-xs text-unbound-muted animate-pulse">
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
        <!-- Load more history indicator -->
        <div
          v-if="hasMoreHistory || loadingMoreHistory"
          class="text-center py-3"
        >
          <Button
            v-if="!loadingMoreHistory"
            variant="outline"
            size="sm"
            class="text-xs text-unbound-cyan-400 hover:text-unbound-glow rounded-full flex items-center gap-1"
            @click="loadMoreHistory"
          >
            <IconChevronUp :size="12" /> Load earlier messages
          </Button>
          <div
            v-else
            class="text-xs text-unbound-muted animate-pulse"
          >
            Loading history...
          </div>
        </div>

        <MessageList
          :messages="messages"
          :streaming-message="streamingMessage"
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
          class="absolute bottom-4 right-8 rounded-full bg-unbound-cyan-600 hover:bg-unbound-cyan-500 shadow-lg shadow-unbound-cyan-900/50 z-10"
          title="Scroll to bottom"
          @click="scrollToBottom"
        >
          <IconChevronDown :size="16" />
        </Button>
      </Transition>
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

    <!-- Rewind Confirmation Modal -->
    <RewindConfirmModal
      :visible="!!pendingRewindMessageId"
      :message-preview="rewindMessagePreview"
      @confirm="handleConfirmRewind"
      @cancel="handleCancelRewind"
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
