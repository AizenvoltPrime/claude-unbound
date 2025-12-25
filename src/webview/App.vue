<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import { onKeyStroke } from '@vueuse/core';
import MessageList from './components/MessageList.vue';
import ChatInput from './components/ChatInput.vue';
import SessionStats from './components/SessionStats.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { Toaster } from '@/components/ui/sonner';
import McpStatusIndicator from './components/McpStatusIndicator.vue';
import McpStatusPanel from './components/McpStatusPanel.vue';
import SubagentIndicator from './components/SubagentIndicator.vue';
import StatusBar from './components/StatusBar.vue';
import BudgetWarning from './components/BudgetWarning.vue';
import RewindConfirmModal from './components/RewindConfirmModal.vue';
import PermissionPrompt from './components/PermissionPrompt.vue';
import { useVSCode } from './composables/useVSCode';
import { useStreamingMessage } from './composables/useStreamingMessage';
import { useMessageHandler } from './composables/useMessageHandler';
import { Button } from '@/components/ui/button';
import {
  IconGear,
  IconClipboard,
  IconCheck,
  IconXMark,
  IconPencil,
  IconChevronUp,
  IconChevronDown,
} from '@/components/icons';
import type {
  ChatMessage,
  ToolCall,
  SessionStats as SessionStatsType,
  FileEntry,
  StoredSession,
  AccountInfo,
  ModelInfo,
  ExtensionSettings,
  McpServerStatusInfo,
  ActiveSubagent,
  CompactMarker,
  PermissionMode,
} from '@shared/types';

const { postMessage } = useVSCode();

// Streaming message composable - handles all message accumulation logic
const streaming = useStreamingMessage();
const {
  messages,
  streamingMessage,
  updateToolStatus,
  clearAll: clearMessages,
} = streaming;
const isProcessing = ref(false);
const accountInfo = ref<AccountInfo | null>(null);
const currentSessionId = ref<string | null>(null);
const sessionStats = ref<SessionStatsType>({
  totalCostUsd: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  numTurns: 0,
  contextWindowSize: 200000,
});
const accessedFiles = ref<Map<string, FileEntry>>(new Map());
const storedSessions = ref<StoredSession[]>([]);
const showSessionPicker = ref(false);
const selectedSessionId = ref<string | null>(null);  // Currently selected/resumed session
const renamingSessionId = ref<string | null>(null);
const renameInputValue = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);
// Session list pagination state
const sessionPickerRef = ref<HTMLElement | null>(null);
const hasMoreSessions = ref(false);
const nextSessionsOffset = ref(0);
const loadingMoreSessions = ref(false);
// History pagination state
const messageContainerRef = ref<HTMLElement | null>(null);
const hasMoreHistory = ref(false);
const nextHistoryOffset = ref(0);
const loadingMoreHistory = ref(false);
const currentResumedSessionId = ref<string | null>(null);
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);

// New state for SDK features
const availableModels = ref<ModelInfo[]>([]);
const currentSettings = ref<ExtensionSettings>({
  model: '',
  maxTurns: 50,
  maxBudgetUsd: null,
  maxThinkingTokens: null,
  betasEnabled: [],
  permissionMode: 'default',
  enableFileCheckpointing: true,
  sandbox: { enabled: false },
});
const mcpServers = ref<McpServerStatusInfo[]>([]);
const activeSubagents = ref<Map<string, ActiveSubagent>>(new Map());
const compactMarkers = ref<CompactMarker[]>([]);
const budgetWarning = ref<{ currentSpend: number; limit: number; exceeded: boolean } | null>(null);
const checkpointMessages = ref<Set<string>>(new Set());

// Track currently running tool for status bar display
const currentRunningTool = ref<string | null>(null);

// UI state
const showSettingsPanel = ref(false);
const showMcpPanel = ref(false);
const pendingRewindMessageId = ref<string | null>(null);
const pendingPermission = ref<{
  toolUseId: string;
  toolName: string;
  filePath?: string;
  originalContent?: string;
  proposedContent?: string;
  command?: string;
} | null>(null);

const filesArray = computed(() => Array.from(accessedFiles.value.values()));
const compactMarkersList = computed(() => compactMarkers.value);

// Get the most recently accessed file for display in input
const lastAccessedFile = computed(() => {
  const files = Array.from(accessedFiles.value.values());
  if (files.length === 0) return undefined;
  // Return the last one (most recent)
  return files[files.length - 1].path;
});

// Get the selected session object for display
const selectedSession = computed(() => {
  if (!selectedSessionId.value) return null;
  return storedSessions.value.find((s: StoredSession) => s.id === selectedSessionId.value) || null;
});

function trackFileAccess(toolName: string, input: Record<string, unknown>) {
  const filePath = input.file_path as string | undefined;
  if (!filePath) return;

  let operation: FileEntry['operation'];
  switch (toolName) {
    case 'Read':
      operation = 'read';
      break;
    case 'Edit':
      operation = 'edit';
      break;
    case 'Write':
      operation = accessedFiles.value.has(filePath) ? 'write' : 'create';
      break;
    default:
      return;
  }

  accessedFiles.value.set(filePath, { path: filePath, operation });
}

// Set up message handler for extension-to-webview communication
useMessageHandler({
  streaming,
  isProcessing,
  accountInfo,
  currentSessionId,
  sessionStats,
  accessedFiles,
  storedSessions,
  selectedSessionId,
  hasMoreSessions,
  nextSessionsOffset,
  loadingMoreSessions,
  hasMoreHistory,
  nextHistoryOffset,
  loadingMoreHistory,
  currentResumedSessionId,
  availableModels,
  currentSettings,
  mcpServers,
  activeSubagents,
  compactMarkers,
  budgetWarning,
  checkpointMessages,
  currentRunningTool,
  pendingPermission,
  messageContainerRef,
  chatInputRef,
  trackFileAccess,
});

function handleSendMessage(content: string) {
  postMessage({ type: 'sendMessage', content });
}

function handleModeChange(mode: PermissionMode) {
  postMessage({ type: 'setPermissionMode', mode });
  currentSettings.value.permissionMode = mode; // Optimistic update
}

function handleCancel() {
  postMessage({ type: 'cancelSession' });
}

function handleResumeSession(sessionId: string) {
  // Clear previous session's data before loading new session
  clearMessages();
  accessedFiles.value.clear();
  sessionStats.value = { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, numTurns: 0, contextWindowSize: 200000 };

  // Reset pagination state for new session
  currentResumedSessionId.value = sessionId;
  selectedSessionId.value = sessionId;  // Track selected session for UI
  hasMoreHistory.value = false;
  nextHistoryOffset.value = 0;
  loadingMoreHistory.value = false;
  postMessage({ type: 'resumeSession', sessionId });
  showSessionPicker.value = false;
}

function toggleSessionPicker() {
  showSessionPicker.value = !showSessionPicker.value;
}

onKeyStroke('Escape', () => {
  if (showSessionPicker.value && !renamingSessionId.value) {
    showSessionPicker.value = false;
  }
});

function startRenameSession(sessionId: string, currentName: string) {
  renamingSessionId.value = sessionId;
  renameInputValue.value = currentName;
  // Focus the input after Vue renders the input element
  nextTick(() => {
    renameInputRef.value?.focus();
    renameInputRef.value?.select();
  });
}

function cancelRenameSession() {
  renamingSessionId.value = null;
  renameInputValue.value = '';
}

function submitRenameSession() {
  if (renamingSessionId.value && renameInputValue.value.trim()) {
    postMessage({
      type: 'renameSession',
      sessionId: renamingSessionId.value,
      newName: renameInputValue.value.trim(),
    });
    cancelRenameSession();
  }
}

// Load more history when scrolling to top
function loadMoreHistory() {
  if (!hasMoreHistory.value || loadingMoreHistory.value || !currentResumedSessionId.value) {
    return;
  }

  loadingMoreHistory.value = true;
  postMessage({
    type: 'requestMoreHistory',
    sessionId: currentResumedSessionId.value,
    offset: nextHistoryOffset.value,
  });
}

// Handle scroll to detect when user is near the top
function handleMessageScroll(event: Event) {
  const container = event.target as HTMLElement;
  if (!container) return;

  // Load more when scrolled within 100px of the top
  if (container.scrollTop < 100 && hasMoreHistory.value && !loadingMoreHistory.value) {
    loadMoreHistory();
  }
}

// Load more sessions when scrolling to bottom of session picker
function loadMoreSessions() {
  if (!hasMoreSessions.value || loadingMoreSessions.value) {
    return;
  }

  loadingMoreSessions.value = true;
  postMessage({
    type: 'requestMoreSessions',
    offset: nextSessionsOffset.value,
  });
}

// Handle scroll in session picker
function handleSessionPickerScroll(event: Event) {
  const container = event.target as HTMLElement;
  if (!container) return;

  // Load more when scrolled within 50px of the bottom
  const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (scrollBottom < 50 && hasMoreSessions.value && !loadingMoreSessions.value) {
    loadMoreSessions();
  }
}

function getSessionDisplayName(session: StoredSession): string {
  // Priority: customTitle (user-set name) > preview (first user message)
  // Note: slug is an internal identifier, not shown to users
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

// New handlers for settings panel (optimistic updates to prevent feedback loops)
function handleSetModel(model: string) {
  currentSettings.value.model = model;
  postMessage({ type: 'setModel', model });
}

function handleSetMaxThinkingTokens(tokens: number | null) {
  currentSettings.value.maxThinkingTokens = tokens;
  postMessage({ type: 'setMaxThinkingTokens', tokens });
}

function handleSetBudgetLimit(budgetUsd: number | null) {
  currentSettings.value.maxBudgetUsd = budgetUsd;
  postMessage({ type: 'setBudgetLimit', budgetUsd });
}

function handleToggleBeta(beta: string, enabled: boolean) {
  if (enabled) {
    currentSettings.value.betasEnabled = [...currentSettings.value.betasEnabled, beta];
  } else {
    currentSettings.value.betasEnabled = currentSettings.value.betasEnabled.filter(b => b !== beta);
  }
  postMessage({ type: 'toggleBeta', beta, enabled });
}

function handleSetPermissionMode(mode: PermissionMode) {
  postMessage({ type: 'setPermissionMode', mode });
}

function handleOpenVSCodeSettings() {
  postMessage({ type: 'openSettings' });
}

function handleOpenSessionLog() {
  postMessage({ type: 'openSessionLog' });
}

// MCP handlers
function handleRefreshMcpStatus() {
  postMessage({ type: 'requestMcpStatus' });
}

// Rewind handlers
function handleRequestRewind(messageId: string) {
  pendingRewindMessageId.value = messageId;
}

function handleConfirmRewind() {
  if (pendingRewindMessageId.value) {
    postMessage({ type: 'rewindToMessage', userMessageId: pendingRewindMessageId.value });
    pendingRewindMessageId.value = null;
  }
}

function handleCancelRewind() {
  pendingRewindMessageId.value = null;
}

// Permission approval handler
function handlePermissionApproval(approved: boolean, options?: { neverAskAgain?: boolean; customMessage?: string }) {
  // Update the tool status in the message list
  if (pendingPermission.value) {
    updateToolStatus(
      pendingPermission.value.toolUseId,
      approved ? 'approved' : 'denied'
    );
  }

  postMessage({
    type: 'approveEdit',
    approved,
    neverAskAgain: options?.neverAskAgain,
    customMessage: options?.customMessage,
  });
  pendingPermission.value = null;
}

// Tool interrupt handler
// Note: toolId is passed from ToolCallCard but current SDK only supports global interrupt
function handleInterrupt(_toolId: string) {
  postMessage({ type: 'interrupt' });
}

// Dismiss budget warning
function handleDismissBudgetWarning() {
  budgetWarning.value = null;
}

// Get message preview for rewind modal
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
        @click="showMcpPanel = true"
      />

      <!-- Settings button -->
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-unbound-cyan-400 hover:bg-unbound-cyan-900/30"
        title="Settings"
        @click="showSettingsPanel = true"
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

    <!-- Active Subagents Indicator -->
    <SubagentIndicator :subagents="activeSubagents" />

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

    <div
      ref="messageContainerRef"
      class="flex-1 min-h-0 overflow-y-auto message-container"
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
        @rewind="handleRequestRewind"
        @interrupt="handleInterrupt"
      />
    </div>

    <!-- Status Bar with witty phrases (above input) -->
    <StatusBar
      :is-processing="isProcessing"
      :current-tool-name="currentRunningTool ?? undefined"
    />

    <SessionStats :stats="sessionStats" @open-log="handleOpenSessionLog" />

    <!-- Permission Prompt (inline bottom bar) -->
    <PermissionPrompt
      :visible="!!pendingPermission"
      :tool-name="pendingPermission?.toolName"
      :file-path="pendingPermission?.filePath"
      :original-content="pendingPermission?.originalContent"
      :proposed-content="pendingPermission?.proposedContent"
      :command="pendingPermission?.command"
      @approve="handlePermissionApproval"
    />

    <ChatInput
      ref="chatInputRef"
      :is-processing="isProcessing"
      :permission-mode="currentSettings.permissionMode"
      :current-file="lastAccessedFile"
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
      @close="showSettingsPanel = false"
      @set-model="handleSetModel"
      @set-max-thinking-tokens="handleSetMaxThinkingTokens"
      @set-budget-limit="handleSetBudgetLimit"
      @toggle-beta="handleToggleBeta"
      @set-permission-mode="handleSetPermissionMode"
      @open-v-s-code-settings="handleOpenVSCodeSettings"
    />

    <!-- MCP Status Panel (modal) -->
    <McpStatusPanel
      :visible="showMcpPanel"
      :servers="mcpServers"
      @close="showMcpPanel = false"
      @refresh="handleRefreshMcpStatus"
    />

    <!-- Rewind Confirmation Modal -->
    <RewindConfirmModal
      :visible="!!pendingRewindMessageId"
      :message-preview="rewindMessagePreview"
      @confirm="handleConfirmRewind"
      @cancel="handleCancelRewind"
    />

  </div>
</template>
