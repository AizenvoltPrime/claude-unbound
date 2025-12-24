<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue';
import MessageList from './components/MessageList.vue';
import ChatInput from './components/ChatInput.vue';
import SessionStats from './components/SessionStats.vue';
import FileTree from './components/FileTree.vue';
import ToastNotification from './components/ToastNotification.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import McpStatusIndicator from './components/McpStatusIndicator.vue';
import McpStatusPanel from './components/McpStatusPanel.vue';
import SubagentIndicator from './components/SubagentIndicator.vue';
import BudgetWarning from './components/BudgetWarning.vue';
import RewindConfirmModal from './components/RewindConfirmModal.vue';
import FileWriteConfirmationDialog from './components/FileWriteConfirmationDialog.vue';
import { useVSCode } from './composables/useVSCode';
import type {
  ChatMessage,
  ToolCall,
  ContentBlock,
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

const { postMessage, onMessage } = useVSCode();

// Logging helper - sends to VS Code output channel
function webLog(...args: unknown[]) {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  postMessage({ type: 'log', message });
}

// Existing state
const messages = ref<ChatMessage[]>([]);
const isProcessing = ref(false);
const accountInfo = ref<AccountInfo | null>(null);
const currentSessionId = ref<string | null>(null);
const sessionStats = ref<SessionStatsType>({
  totalCostUsd: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  numTurns: 0,
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
const currentNotification = ref<{ id: number; message: string; type: string } | null>(null);
let notificationId = 0;
const pendingTool = ref<{ name: string; input: unknown } | null>(null);
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

// Tool status cache - stores statuses received before tools are added to the UI
// This handles the race condition where toolCompleted/toolFailed arrives before the assistant message
const toolStatusCache = ref<Map<string, { status: ToolCall['status']; result?: string; errorMessage?: string }>>(new Map());

// UI state
const showSettingsPanel = ref(false);
const showMcpPanel = ref(false);
const pendingRewindMessageId = ref<string | null>(null);
const pendingPermission = ref<{
  toolUseId: string;
  toolName: string;
  filePath: string;
  originalContent: string;
  proposedContent: string;
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
  return storedSessions.value.find(s => s.id === selectedSessionId.value) || null;
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

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  webLog('[App] handleResumeSession clicked:', sessionId);

  // Clear previous session's data before loading new session
  messages.value = [];
  accessedFiles.value.clear();
  toolStatusCache.value.clear();
  sessionStats.value = { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, numTurns: 0 };

  // Reset pagination state for new session
  currentResumedSessionId.value = sessionId;
  selectedSessionId.value = sessionId;  // Track selected session for UI
  hasMoreHistory.value = false;
  nextHistoryOffset.value = 0;
  loadingMoreHistory.value = false;
  postMessage({ type: 'resumeSession', sessionId });
  // Don't close the picker - let user see the selection like a select box
}

function toggleSessionPicker() {
  showSessionPicker.value = !showSessionPicker.value;
}

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

  webLog('[App] Loading more history, offset:', nextHistoryOffset.value);
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

  webLog('[App] Loading more sessions, offset:', nextSessionsOffset.value);
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

function extractTextFromContent(content: ContentBlock[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function extractToolCalls(content: ContentBlock[]): ToolCall[] {
  return content
    .filter((block): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
      block.type === 'tool_use'
    )
    .map((block) => {
      // Check if we have a cached status for this tool (handles race condition)
      const cached = toolStatusCache.value.get(block.id);
      if (cached) {
        // Apply the cached status and clean up the cache entry
        toolStatusCache.value.delete(block.id);
        return {
          id: block.id,
          name: block.name,
          input: block.input,
          status: cached.status,
          result: cached.result,
          errorMessage: cached.errorMessage,
        };
      }
      // No cached status, default to pending
      return {
        id: block.id,
        name: block.name,
        input: block.input,
        status: 'pending' as const,
      };
    });
}

function extractThinkingContent(content: ContentBlock[]): string | undefined {
  const thinkingBlocks = content.filter(
    (block): block is { type: 'thinking'; thinking: string } => block.type === 'thinking'
  );
  if (thinkingBlocks.length === 0) return undefined;
  return thinkingBlocks.map((block) => block.thinking).join('\n\n');
}

// Merge tool calls by ID, keeping the one with the most advanced status
function mergeToolCalls(existing: ToolCall[] | undefined, incoming: ToolCall[]): ToolCall[] {
  const statusPriority: Record<ToolCall['status'], number> = {
    pending: 0,
    running: 1,
    awaiting_approval: 2,
    approved: 3,
    denied: 3,
    completed: 4,
    failed: 4,
    abandoned: 4,  // Same priority as completed/failed - it's a terminal state
  };

  const merged = new Map<string, ToolCall>();

  // Add existing tools first
  for (const tool of existing || []) {
    merged.set(tool.id, tool);
  }

  // Merge incoming tools, keeping the one with higher priority status
  for (const tool of incoming) {
    const existing = merged.get(tool.id);
    if (!existing || statusPriority[tool.status] >= statusPriority[existing.status]) {
      merged.set(tool.id, tool);
    }
  }

  return Array.from(merged.values());
}

// New handlers for settings panel
function handleSetModel(model: string) {
  postMessage({ type: 'setModel', model });
}

function handleSetMaxThinkingTokens(tokens: number | null) {
  postMessage({ type: 'setMaxThinkingTokens', tokens });
}

function handleSetBudgetLimit(budgetUsd: number | null) {
  postMessage({ type: 'setBudgetLimit', budgetUsd });
}

function handleToggleBeta(beta: string, enabled: boolean) {
  postMessage({ type: 'toggleBeta', beta, enabled });
}

function handleSetPermissionMode(mode: PermissionMode) {
  postMessage({ type: 'setPermissionMode', mode });
}

function handleOpenVSCodeSettings() {
  postMessage({ type: 'openSettings' });
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
  const msg = messages.value.find(m => m.id === pendingRewindMessageId.value);
  return msg?.content.slice(0, 100) || '';
});

// Update tool status in messages (and cache for race condition handling)
function updateToolStatus(toolUseId: string, status: ToolCall['status'], result?: string, errorMessage?: string) {
  // Always cache the status - this ensures we have it even if the tool isn't in UI yet
  toolStatusCache.value.set(toolUseId, { status, result, errorMessage });

  // Also update any existing tool in the message list
  for (const msg of messages.value) {
    if (msg.toolCalls) {
      const tool = msg.toolCalls.find(t => t.id === toolUseId);
      if (tool) {
        tool.status = status;
        if (result !== undefined) tool.result = result;
        if (errorMessage !== undefined) tool.errorMessage = errorMessage;
        break;
      }
    }
  }
}

onMounted(() => {
  onMessage((message) => {
    switch (message.type) {
      case 'userMessage':
        messages.value.push({
          id: generateId(),
          role: 'user',
          content: message.content,
          timestamp: Date.now(),
        });
        break;

      case 'assistant': {
        const assistantMsg = message.data;
        const msgId = assistantMsg.message.id;
        const textContent = extractTextFromContent(assistantMsg.message.content);
        const toolCalls = extractToolCalls(assistantMsg.message.content);
        const thinkingContent = extractThinkingContent(assistantMsg.message.content);
        webLog('[App] assistant received, msgId:', msgId, 'toolCalls:', toolCalls.length, 'hasText:', !!textContent);

        // Track file access from tool calls
        for (const tool of toolCalls) {
          trackFileAccess(tool.name, tool.input);
        }

        // Find streaming message by sdkMessageId (canonical identity)
        let streamingMsg = messages.value.find(m =>
          m.role === 'assistant' && m.isPartial && m.sdkMessageId === msgId
        );

        // If not found by sdkMessageId, check for unclaimed streaming message
        if (!streamingMsg) {
          const lastMsg = messages.value[messages.value.length - 1];
          if (lastMsg?.role === 'assistant' && lastMsg.isPartial && !lastMsg.sdkMessageId) {
            webLog('[App] assistant: claiming unclaimed streaming message', lastMsg.id, 'for sdkMsgId:', msgId);
            lastMsg.sdkMessageId = msgId;
            streamingMsg = lastMsg;
          }
        }

        webLog('[App] assistant: streamingMsg:', streamingMsg?.id, 'sdkMsgId:', streamingMsg?.sdkMessageId);

        if (streamingMsg) {
          // Finalize streaming message
          webLog('[App] assistant: FINALIZING streaming message, existing tools:', streamingMsg.toolCalls?.length ?? 0);
          streamingMsg.id = msgId; // Update display ID to final SDK ID
          if (textContent) streamingMsg.content = textContent;
          if (thinkingContent) streamingMsg.thinking = thinkingContent;
          if (toolCalls.length > 0) {
            // Merge tools by ID, preserving statuses already received via lifecycle events
            streamingMsg.toolCalls = mergeToolCalls(streamingMsg.toolCalls, toolCalls);
            webLog('[App] assistant: after merge, tools:', streamingMsg.toolCalls?.length ?? 0);
          }
          streamingMsg.isPartial = false;
          streamingMsg.isThinkingPhase = false; // Ensure animation stops
          webLog('[App] assistant: finalized, isPartial=false, isThinkingPhase=false');
        } else {
          // Create new message (no streaming happened)
          webLog('[App] assistant: creating new message (no streaming)');
          messages.value.push({
            id: msgId,
            sdkMessageId: msgId,
            role: 'assistant',
            content: textContent,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            thinking: thinkingContent,
            timestamp: Date.now(),
            isPartial: false,
          });
        }
        currentSessionId.value = assistantMsg.session_id;
        break;
      }

      case 'partial': {
        const partialData = message.data;
        const partialMsgId = partialData.messageId;
        webLog('[App] partial received, msgId:', partialMsgId, 'isThinking:', partialData.isThinking);

        // Find the target message using sdkMessageId (the canonical identity)
        let targetMsg: ChatMessage | undefined;
        if (partialMsgId) {
          // Look for message by sdkMessageId (proper identity matching)
          targetMsg = messages.value.find(m =>
            m.role === 'assistant' && m.sdkMessageId === partialMsgId
          );

          // If not found, claim an unclaimed streaming message
          if (!targetMsg) {
            const lastMsg = messages.value[messages.value.length - 1];
            if (lastMsg?.role === 'assistant' && lastMsg.isPartial && !lastMsg.sdkMessageId) {
              // Claim this streaming message by setting its sdkMessageId
              webLog('[App] partial: claiming streaming message', lastMsg.id, 'for sdkMessageId:', partialMsgId);
              lastMsg.sdkMessageId = partialMsgId;
              targetMsg = lastMsg;
            }
          }
        } else {
          // No messageId yet - use unclaimed streaming message
          const lastMsg = messages.value[messages.value.length - 1];
          if (lastMsg?.role === 'assistant' && lastMsg.isPartial && !lastMsg.sdkMessageId) {
            targetMsg = lastMsg;
          }
        }

        webLog('[App] partial: targetMsg:', targetMsg?.id, 'sdkMsgId:', targetMsg?.sdkMessageId, 'hasTools:', targetMsg?.toolCalls?.length ?? 0);

        if (targetMsg && targetMsg.isPartial) {
          // Update existing streaming message
          if (partialData.streamingThinking !== undefined) {
            targetMsg.thinking = partialData.streamingThinking;
          }
          if (partialData.streamingText !== undefined) {
            targetMsg.content = partialData.streamingText;
          }
          // Track thinking phase for animation control
          // BUT: once tools are present, thinking phase is definitively over
          if (!targetMsg.toolCalls || targetMsg.toolCalls.length === 0) {
            targetMsg.isThinkingPhase = partialData.isThinking ?? false;
            webLog('[App] partial: set isThinkingPhase to', targetMsg.isThinkingPhase);
          } else {
            webLog('[App] partial: SKIPPED setting isThinkingPhase (has tools)');
          }
        } else {
          // Create new streaming message
          const newId = `streaming-${Date.now()}`;
          webLog('[App] partial: CREATING new streaming message:', newId, 'sdkMsgId:', partialMsgId, 'isThinking:', partialData.isThinking);
          messages.value.push({
            id: newId,
            sdkMessageId: partialMsgId ?? undefined,
            role: 'assistant',
            content: partialData.streamingText || '',
            thinking: partialData.streamingThinking,
            timestamp: Date.now(),
            isPartial: true,
            isThinkingPhase: partialData.isThinking ?? false,
          });
        }
        break;
      }

      case 'done':
        const resultData = message.data;
        // Mark last message as complete
        const finalMsg = messages.value[messages.value.length - 1];
        webLog('[App] done received, finalMsg:', finalMsg?.id, 'role:', finalMsg?.role, 'isPartial:', finalMsg?.isPartial, 'isThinkingPhase:', finalMsg?.isThinkingPhase);
        if (finalMsg?.role === 'assistant') {
          finalMsg.isPartial = false;
          finalMsg.isThinkingPhase = false;
          webLog('[App] done: set isPartial=false, isThinkingPhase=false');
        }
        // Update session stats
        if (resultData.total_cost_usd !== undefined) {
          sessionStats.value.totalCostUsd = resultData.total_cost_usd;
        }
        if (resultData.total_input_tokens !== undefined) {
          sessionStats.value.totalInputTokens = resultData.total_input_tokens;
        }
        if (resultData.total_output_tokens !== undefined) {
          sessionStats.value.totalOutputTokens = resultData.total_output_tokens;
        }
        if (resultData.num_turns !== undefined) {
          sessionStats.value.numTurns = resultData.num_turns;
        }
        break;

      case 'processing':
        isProcessing.value = message.isProcessing;
        break;

      case 'error':
        messages.value.push({
          id: generateId(),
          role: 'assistant',
          content: `**Error:** ${message.message}`,
          timestamp: Date.now(),
        });
        break;

      case 'sessionStarted':
        currentSessionId.value = message.sessionId;
        break;

      case 'storedSessions':
        loadingMoreSessions.value = false;
        // First page: replace list. Pagination: append to list.
        // Use explicit isFirstPage flag from server (falls back to checking if we have no sessions)
        const isFirstPage = message.isFirstPage ?? storedSessions.value.length === 0;
        if (isFirstPage) {
          storedSessions.value = message.sessions;
        } else {
          storedSessions.value = [...storedSessions.value, ...message.sessions];
        }
        hasMoreSessions.value = message.hasMore ?? false;
        nextSessionsOffset.value = message.nextOffset ?? message.sessions.length;
        break;

      case 'sessionCleared':
        messages.value = [];
        accessedFiles.value.clear();
        toolStatusCache.value.clear();
        sessionStats.value = { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, numTurns: 0 };
        currentSessionId.value = null;
        selectedSessionId.value = null;  // Clear selection when session is cleared
        // Reset pagination state
        currentResumedSessionId.value = null;
        hasMoreHistory.value = false;
        nextHistoryOffset.value = 0;
        loadingMoreHistory.value = false;
        break;

      case 'sessionRenamed':
        webLog('[App] Session renamed:', message.sessionId, '->', message.newName);
        // The storedSessions will be refreshed by the extension after renaming
        break;

      case 'toolPending':
        // Legacy - kept for backwards compatibility but toolStreaming is preferred
        pendingTool.value = { name: message.toolName, input: message.input };
        setTimeout(() => {
          pendingTool.value = null;
        }, 2000);
        break;

      case 'toolStreaming': {
        // Add tool to the CORRECT message (identified by sdkMessageId)
        // This fixes the bug where tools from message B were added to message A
        const targetMsgId = message.messageId;
        webLog('[App] toolStreaming received:', message.tool.name, message.tool.id, 'sdkMsgId:', targetMsgId);

        // Find message by sdkMessageId (the canonical identity)
        let targetMsg = messages.value.find(m =>
          m.role === 'assistant' && m.sdkMessageId === targetMsgId
        );

        // If not found, claim an unclaimed streaming message
        if (!targetMsg) {
          const lastMsg = messages.value[messages.value.length - 1];
          if (lastMsg?.role === 'assistant' && lastMsg.isPartial && !lastMsg.sdkMessageId) {
            // Claim this streaming message by setting its sdkMessageId
            webLog('[App] toolStreaming: claiming streaming message', lastMsg.id, 'for sdkMessageId:', targetMsgId);
            lastMsg.sdkMessageId = targetMsgId;
            targetMsg = lastMsg;
          }
        }

        // If still no message exists, create a new streaming message
        if (!targetMsg) {
          webLog('[App] toolStreaming: creating new streaming message for sdkMsgId:', targetMsgId);
          const newMsg: ChatMessage = {
            id: `streaming-${Date.now()}`,
            sdkMessageId: targetMsgId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            isPartial: true,
            isThinkingPhase: false, // Tool arrival means thinking is over
            toolCalls: [],
          };
          messages.value.push(newMsg);
          targetMsg = newMsg;
        }

        webLog('[App] toolStreaming: targetMsg:', targetMsg.id, 'sdkMsgId:', targetMsg.sdkMessageId, 'isThinkingPhase:', targetMsg.isThinkingPhase);

        // Tool arrival means thinking phase is OVER - Claude has decided to act
        targetMsg.isThinkingPhase = false;

        if (!targetMsg.toolCalls) {
          targetMsg.toolCalls = [];
        }
        // Only add if not already present (avoid duplicates)
        if (!targetMsg.toolCalls.find(t => t.id === message.tool.id)) {
          // Check cache for any status already received
          const cached = toolStatusCache.value.get(message.tool.id);
          webLog('[App] toolStreaming: adding tool to', targetMsg.id, 'cached status:', cached?.status);
          targetMsg.toolCalls.push({
            id: message.tool.id,
            name: message.tool.name,
            input: message.tool.input,
            status: cached?.status ?? 'pending',
            result: cached?.result,
            errorMessage: cached?.errorMessage,
          });
          if (cached) {
            toolStatusCache.value.delete(message.tool.id);
          }
          // Track file access
          trackFileAccess(message.tool.name, message.tool.input);
        } else {
          webLog('[App] toolStreaming: tool already exists in', targetMsg.id, 'skipping');
        }
        break;
      }

      case 'requestPermission': {
        // Add the tool call to the message list so user can see what's being requested
        const toolCall: ToolCall = {
          id: message.toolUseId,
          name: message.toolName,
          input: message.toolInput,
          status: 'awaiting_approval',
        };

        // Find the current streaming/last assistant message or create a new one
        const lastMsg = messages.value[messages.value.length - 1];
        if (lastMsg?.role === 'assistant') {
          // Add tool call to existing message
          if (!lastMsg.toolCalls) {
            lastMsg.toolCalls = [];
          }
          // Only add if not already present
          if (!lastMsg.toolCalls.find(t => t.id === message.toolUseId)) {
            lastMsg.toolCalls.push(toolCall);
          }
        } else {
          // Create new assistant message with this tool call
          messages.value.push({
            id: `permission-${message.toolUseId}`,
            role: 'assistant',
            content: '',
            toolCalls: [toolCall],
            timestamp: Date.now(),
            isPartial: true,
          });
        }

        // Track file access
        trackFileAccess(message.toolName, message.toolInput);

        // Now show the permission dialog
        pendingPermission.value = {
          toolUseId: message.toolUseId,
          toolName: message.toolName,
          filePath: message.filePath,
          originalContent: message.originalContent,
          proposedContent: message.proposedContent,
        };
        break;
      }

      case 'notification':
        // Use unique ID so watch detects each notification as different
        currentNotification.value = {
          id: ++notificationId,
          message: message.message,
          type: message.notificationType,
        };
        break;

      case 'accountInfo':
        accountInfo.value = message.data;
        break;

      // New: Model and settings
      case 'availableModels':
        availableModels.value = message.models;
        break;

      case 'settingsUpdate':
        currentSettings.value = message.settings;
        break;

      // New: MCP server status
      case 'mcpServerStatus':
        mcpServers.value = message.servers;
        break;

      // New: Budget tracking
      case 'budgetWarning':
        budgetWarning.value = {
          currentSpend: message.currentSpend,
          limit: message.limit,
          exceeded: false,
        };
        break;

      case 'budgetExceeded':
        budgetWarning.value = {
          currentSpend: message.finalSpend,
          limit: message.limit,
          exceeded: true,
        };
        break;

      // New: Tool lifecycle
      case 'toolCompleted':
        webLog('[App] toolCompleted received:', message.toolUseId, message.toolName);
        updateToolStatus(message.toolUseId, 'completed', message.result);
        break;

      case 'toolFailed':
        webLog('[App] toolFailed received:', message.toolUseId, message.toolName, 'error:', message.error);
        updateToolStatus(message.toolUseId, 'failed', undefined, message.error);
        break;

      case 'toolAbandoned':
        // Tool was streamed but never executed (Claude changed course)
        webLog('[App] toolAbandoned received:', message.toolUseId, message.toolName);
        updateToolStatus(message.toolUseId, 'abandoned');
        break;

      // New: Subagent lifecycle
      case 'subagentStart':
        activeSubagents.value.set(message.agentId, {
          id: message.agentId,
          type: message.agentType,
          startTime: Date.now(),
        });
        break;

      case 'subagentStop':
        activeSubagents.value.delete(message.agentId);
        break;

      // New: Compaction markers
      case 'compactBoundary':
        compactMarkers.value.push({
          id: generateId(),
          timestamp: Date.now(),
          trigger: message.trigger,
          preTokens: message.preTokens,
        });
        break;

      // New: File checkpointing
      case 'checkpointInfo':
        checkpointMessages.value = new Set(message.checkpoints.map((cp: { userMessageId: string }) => cp.userMessageId));
        break;

      case 'rewindComplete':
        currentNotification.value = {
          id: ++notificationId,
          message: 'Files rewound successfully',
          type: 'success',
        };
        break;

      case 'rewindError':
        currentNotification.value = {
          id: ++notificationId,
          message: `Rewind failed: ${message.message}`,
          type: 'error',
        };
        break;

      // New: User message replay (for resumed sessions)
      case 'userReplay':
        webLog('[App] userReplay received:', message.content.slice(0, 50));
        messages.value.push({
          id: generateId(),
          role: 'user',
          content: message.content,
          timestamp: Date.now(),
          isReplay: true,
        });
        break;

      // New: Assistant message replay (for resumed sessions)
      case 'assistantReplay':
        webLog('[App] assistantReplay received:', message.content.slice(0, 50));
        messages.value.push({
          id: generateId(),
          role: 'assistant',
          content: message.content,
          thinking: message.thinking,
          timestamp: Date.now(),
          isReplay: true,
        });
        break;

      // History pagination chunk
      case 'historyChunk': {
        webLog('[App] historyChunk received:', message.messages.length, 'messages, hasMore:', message.hasMore);
        loadingMoreHistory.value = false;
        hasMoreHistory.value = message.hasMore;
        nextHistoryOffset.value = message.nextOffset;

        // Prepend older messages to the front of the list
        if (message.messages.length > 0) {
          const container = messageContainerRef.value;
          const previousScrollHeight = container?.scrollHeight || 0;

          const olderMessages: ChatMessage[] = message.messages.map(msg => ({
            id: generateId(),
            role: msg.type,
            content: msg.content,
            thinking: msg.thinking,
            timestamp: Date.now(),
            isReplay: true,
          }));

          // Prepend to front (older messages come first)
          messages.value = [...olderMessages, ...messages.value];

          // Maintain scroll position after prepending
          nextTick(() => {
            if (container) {
              const newScrollHeight = container.scrollHeight;
              container.scrollTop = newScrollHeight - previousScrollHeight;
            }
          });
        }
        break;
      }

      // New: Session lifecycle
      case 'sessionStart':
        // Could show a subtle indicator based on message.source
        break;

      case 'sessionEnd':
        isProcessing.value = false;
        break;
    }

    // Scroll to bottom on new messages
    nextTick(() => {
      const container = document.querySelector('.message-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  });

  // Notify extension that webview is ready
  webLog('[App] Sending ready message to extension');
  postMessage({ type: 'ready' });

  // Auto-focus the chat input when panel opens
  nextTick(() => {
    chatInputRef.value?.focus();
  });
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
      <button
        class="p-1 rounded hover:bg-unbound-cyan-900/30 transition-colors text-lg text-unbound-cyan-400"
        title="Settings"
        @click="showSettingsPanel = true"
      >
        ⚙️
      </button>
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
      <button
        class="w-full text-xs text-unbound-cyan-400 hover:text-unbound-glow flex items-center gap-2 p-2 rounded border border-unbound-cyan-800/50 hover:border-unbound-cyan-600/50 transition-colors bg-unbound-bg"
        @click="toggleSessionPicker"
      >
        <span>📋</span>
        <span v-if="selectedSession" class="flex-1 text-left truncate text-unbound-text">
          {{ getSessionDisplayName(selectedSession) }}
        </span>
        <span v-else class="flex-1 text-left text-unbound-muted">
          Select a session ({{ storedSessions.length }})
        </span>
        <span class="text-unbound-muted">{{ showSessionPicker ? '▲' : '▼' }}</span>
      </button>

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
            <button
              class="px-2 py-1 text-xs bg-unbound-cyan-700 hover:bg-unbound-cyan-600 rounded text-unbound-text"
              @click="submitRenameSession"
            >✓</button>
            <button
              class="px-2 py-1 text-xs bg-unbound-bg hover:bg-unbound-cyan-900/30 rounded text-unbound-muted"
              @click="cancelRenameSession"
            >✗</button>
          </div>
          <!-- Normal display mode -->
          <div v-else class="flex items-center">
            <button
              class="flex-1 text-left p-2 text-xs rounded transition-colors text-unbound-text"
              :class="[
                selectedSessionId === session.id
                  ? 'bg-unbound-cyan-900/50 border-l-2 border-unbound-cyan-400'
                  : 'hover:bg-unbound-cyan-900/30'
              ]"
              @click="handleResumeSession(session.id)"
            >
              <div class="font-medium truncate flex items-center gap-1">
                <span v-if="selectedSessionId === session.id" class="text-unbound-cyan-400">✓</span>
                {{ getSessionDisplayName(session) }}
              </div>
              <div class="text-unbound-muted" :class="{ 'ml-4': selectedSessionId === session.id }">
                {{ formatSessionTime(session.timestamp) }}
              </div>
            </button>
            <button
              class="p-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity text-unbound-muted hover:text-unbound-cyan-400"
              title="Rename session"
              @click.stop="startRenameSession(session.id, getSessionDisplayName(session))"
            >✏️</button>
          </div>
        </div>
        <!-- Load more indicator -->
        <div v-if="hasMoreSessions || loadingMoreSessions" class="text-center py-2">
          <button
            v-if="!loadingMoreSessions"
            class="text-xs text-unbound-cyan-400 hover:text-unbound-glow"
            @click="loadMoreSessions"
          >
            ↓ Load more sessions
          </button>
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
        <button
          v-if="!loadingMoreHistory"
          class="text-xs text-unbound-cyan-400 hover:text-unbound-glow px-3 py-1.5 rounded-full border border-unbound-cyan-700 hover:border-unbound-cyan-500 transition-colors"
          @click="loadMoreHistory"
        >
          ↑ Load earlier messages
        </button>
        <div
          v-else
          class="text-xs text-unbound-muted animate-pulse"
        >
          Loading history...
        </div>
      </div>

      <MessageList
        :messages="messages"
        :compact-markers="compactMarkersList"
        :checkpoint-messages="checkpointMessages"
        @rewind="handleRequestRewind"
        @interrupt="handleInterrupt"
      />
    </div>

    <!-- Pending tool indicator -->
    <div
      v-if="pendingTool"
      class="mx-3 mb-2 px-3 py-2 text-xs rounded bg-unbound-bg-card border border-unbound-cyan-800/50 animate-pulse"
    >
      <span class="text-unbound-muted">Running:</span>
      <span class="font-medium ml-1 text-unbound-cyan-300">{{ pendingTool.name }}</span>
    </div>

    <FileTree v-if="filesArray.length > 0" :files="filesArray" class="mx-3 mb-2" />
    <SessionStats :stats="sessionStats" />
    <ChatInput
      ref="chatInputRef"
      :is-processing="isProcessing"
      :permission-mode="currentSettings.permissionMode"
      :current-file="lastAccessedFile"
      @send="handleSendMessage"
      @cancel="handleCancel"
      @change-mode="handleModeChange"
    />

    <!-- Toast notifications -->
    <ToastNotification :notification="currentNotification" />

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

    <!-- File Write/Edit Confirmation Dialog -->
    <FileWriteConfirmationDialog
      :visible="!!pendingPermission"
      :tool-name="pendingPermission?.toolName"
      :file-path="pendingPermission?.filePath"
      :original-content="pendingPermission?.originalContent"
      :proposed-content="pendingPermission?.proposedContent"
      @approve="handlePermissionApproval"
    />
  </div>
</template>
