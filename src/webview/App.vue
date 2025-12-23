<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue';
import MessageList from './components/MessageList.vue';
import ChatInput from './components/ChatInput.vue';
import SessionStats from './components/SessionStats.vue';
import FileTree from './components/FileTree.vue';
import ToastNotification from './components/ToastNotification.vue';
import { useVSCode } from './composables/useVSCode';
import type { ChatMessage, ToolCall, ContentBlock, SessionStats as SessionStatsType, FileEntry, StoredSession, AccountInfo } from '@shared/types';

const { postMessage, onMessage } = useVSCode();

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
const currentNotification = ref<{ id: number; message: string; type: string } | null>(null);
let notificationId = 0;
const pendingTool = ref<{ name: string; input: unknown } | null>(null);

const filesArray = computed(() => Array.from(accessedFiles.value.values()));

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

function handleSend(content: string, agentId: string) {
  postMessage({ type: 'sendMessage', content, agentId: agentId !== 'default' ? agentId : undefined });
}

function handleCancel() {
  postMessage({ type: 'cancelSession' });
}

function handleResumeSession(sessionId: string) {
  postMessage({ type: 'resumeSession', sessionId });
  showSessionPicker.value = false;
}

function toggleSessionPicker() {
  showSessionPicker.value = !showSessionPicker.value;
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
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input,
      status: 'pending' as const,
    }));
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

      case 'assistant':
        const assistantMsg = message.data;
        const textContent = extractTextFromContent(assistantMsg.message.content);
        const toolCalls = extractToolCalls(assistantMsg.message.content);

        // Track file access from tool calls
        for (const tool of toolCalls) {
          trackFileAccess(tool.name, tool.input);
        }

        messages.value.push({
          id: assistantMsg.message.id,
          role: 'assistant',
          content: textContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp: Date.now(),
        });
        currentSessionId.value = assistantMsg.session_id;
        break;

      case 'partial':
        // Update the last assistant message if it's partial
        const lastMsg = messages.value[messages.value.length - 1];
        if (lastMsg?.role === 'assistant') {
          lastMsg.isPartial = true;
        }
        break;

      case 'done':
        const resultData = message.data;
        // Mark last message as complete
        const finalMsg = messages.value[messages.value.length - 1];
        if (finalMsg?.role === 'assistant') {
          finalMsg.isPartial = false;
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
        storedSessions.value = message.sessions;
        break;

      case 'sessionCleared':
        messages.value = [];
        accessedFiles.value.clear();
        sessionStats.value = { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, numTurns: 0 };
        currentSessionId.value = null;
        break;

      case 'toolPending':
        pendingTool.value = { name: message.toolName, input: message.input };
        // Clear after a short delay (tool will either complete or show in message)
        setTimeout(() => {
          pendingTool.value = null;
        }, 2000);
        break;

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
  postMessage({ type: 'ready' });
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Account info header -->
    <div v-if="accountInfo" class="px-3 py-1.5 text-xs border-b border-vscode-border flex items-center gap-2 opacity-70">
      <span v-if="accountInfo.email">{{ accountInfo.email }}</span>
      <span v-if="accountInfo.subscriptionType" class="px-1.5 py-0.5 rounded bg-vscode-button-bg text-vscode-button-fg">
        {{ accountInfo.subscriptionType }}
      </span>
    </div>

    <!-- Session picker dropdown -->
    <div v-if="storedSessions.length > 0 && messages.length === 0" class="px-3 py-2 border-b border-vscode-border">
      <button
        class="text-xs text-vscode-button-bg hover:underline flex items-center gap-1"
        @click="toggleSessionPicker"
      >
        <span>📋</span>
        <span>Resume previous session ({{ storedSessions.length }})</span>
        <span>{{ showSessionPicker ? '▲' : '▼' }}</span>
      </button>

      <div v-if="showSessionPicker" class="mt-2 space-y-1 max-h-40 overflow-y-auto">
        <button
          v-for="session in storedSessions"
          :key="session.id"
          class="w-full text-left p-2 text-xs rounded hover:bg-vscode-input-bg transition-colors"
          @click="handleResumeSession(session.id)"
        >
          <div class="font-medium truncate">{{ session.preview }}</div>
          <div class="opacity-50">{{ formatSessionTime(session.timestamp) }}</div>
        </button>
      </div>
    </div>

    <MessageList :messages="messages" class="flex-1 overflow-y-auto message-container" />

    <!-- Pending tool indicator -->
    <div
      v-if="pendingTool"
      class="mx-3 mb-2 px-3 py-2 text-xs rounded bg-vscode-input-bg border border-vscode-border animate-pulse"
    >
      <span class="opacity-70">Running:</span>
      <span class="font-medium ml-1">{{ pendingTool.name }}</span>
    </div>

    <FileTree v-if="filesArray.length > 0" :files="filesArray" class="mx-3 mb-2" />
    <SessionStats :stats="sessionStats" />
    <ChatInput
      :is-processing="isProcessing"
      @send="handleSend"
      @cancel="handleCancel"
    />

    <!-- Toast notifications -->
    <ToastNotification :notification="currentNotification" />
  </div>
</template>
