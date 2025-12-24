import { onMounted, nextTick } from 'vue';
import type { Ref, ComponentPublicInstance } from 'vue';
import { toast } from 'vue-sonner';
import { useVSCode } from './useVSCode';
import type { UseStreamingMessageReturn } from './useStreamingMessage';
import type {
  ChatMessage,
  ToolCall,
  SessionStats,
  FileEntry,
  StoredSession,
  AccountInfo,
  ModelInfo,
  ExtensionSettings,
  McpServerStatusInfo,
  ActiveSubagent,
  CompactMarker,
  HistoryMessage,
  HistoryToolCall,
} from '@shared/types';

/**
 * Options for setting up the message handler.
 * These are refs and callbacks from the parent component.
 */
export interface MessageHandlerOptions {
  // Streaming message composable
  streaming: UseStreamingMessageReturn;

  // App state refs
  isProcessing: Ref<boolean>;
  accountInfo: Ref<AccountInfo | null>;
  currentSessionId: Ref<string | null>;
  sessionStats: Ref<SessionStats>;
  accessedFiles: Ref<Map<string, FileEntry>>;
  storedSessions: Ref<StoredSession[]>;
  selectedSessionId: Ref<string | null>;
  hasMoreSessions: Ref<boolean>;
  nextSessionsOffset: Ref<number>;
  loadingMoreSessions: Ref<boolean>;
  hasMoreHistory: Ref<boolean>;
  nextHistoryOffset: Ref<number>;
  loadingMoreHistory: Ref<boolean>;
  currentResumedSessionId: Ref<string | null>;
  availableModels: Ref<ModelInfo[]>;
  currentSettings: Ref<ExtensionSettings>;
  mcpServers: Ref<McpServerStatusInfo[]>;
  activeSubagents: Ref<Map<string, ActiveSubagent>>;
  compactMarkers: Ref<CompactMarker[]>;
  budgetWarning: Ref<{ currentSpend: number; limit: number; exceeded: boolean } | null>;
  checkpointMessages: Ref<Set<string>>;
  currentRunningTool: Ref<string | null>;
  pendingPermission: Ref<{
    toolUseId: string;
    toolName: string;
    filePath: string;
    originalContent: string;
    proposedContent: string;
  } | null>;

  // DOM refs for scroll management
  messageContainerRef: Ref<HTMLElement | null>;
  chatInputRef: Ref<ComponentPublicInstance<{ focus: () => void }> | null>;

  // Callbacks
  trackFileAccess: (toolName: string, input: Record<string, unknown>) => void;
}

/**
 * Convert HistoryToolCall[] to ToolCall[] (history tools are always completed)
 */
function convertHistoryTools(tools: HistoryToolCall[] | undefined): ToolCall[] | undefined {
  return tools?.map((t) => ({
    id: t.id,
    name: t.name,
    input: t.input,
    status: 'completed' as const,
    result: t.result,
  }));
}

/**
 * Composable that sets up the message handler for extension-to-webview communication.
 * Handles all incoming messages from the VS Code extension and updates app state accordingly.
 */
export function useMessageHandler(options: MessageHandlerOptions): void {
  const { postMessage, onMessage } = useVSCode();
  const {
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
  } = options;

  // Destructure streaming message functions
  const {
    messages,
    streamingMessage,
    generateId,
    finalizeStreamingMessage,
    checkAndFinalizeForNewMessageId,
    ensureStreamingMessage,
    updateToolStatus,
    addToolCall,
    mergeToolCalls,
    extractTextFromContent,
    extractToolCalls,
    extractThinkingContent,
    addUserMessage,
    addErrorMessage,
    clearAll: clearMessages,
    prependMessages,
  } = streaming;

  onMounted(() => {
    onMessage((message) => {
      switch (message.type) {
        case 'userMessage':
          addUserMessage(message.content);
          break;

        case 'assistant': {
          const assistantMsg = message.data;
          const msgId = assistantMsg.message.id;
          const textContent = extractTextFromContent(assistantMsg.message.content);
          const toolCalls = extractToolCalls(assistantMsg.message.content);
          const thinkingContent = extractThinkingContent(assistantMsg.message.content);

          // Track file access from tool calls
          for (const tool of toolCalls) {
            trackFileAccess(tool.name, tool.input);
          }

          // Finalize previous message if SDK message ID changed
          checkAndFinalizeForNewMessageId(msgId);

          // Get or create streaming message
          const msg = ensureStreamingMessage(msgId);

          if (textContent) {
            msg.content = textContent;
          }
          if (thinkingContent) {
            msg.thinking = thinkingContent;
          }
          if (toolCalls.length > 0) {
            msg.toolCalls = mergeToolCalls(msg.toolCalls, toolCalls);
          }
          // Stop thinking animation once we have tools or text
          if (toolCalls.length > 0 || textContent) {
            msg.isThinkingPhase = false;
          }

          currentSessionId.value = assistantMsg.session_id;
          break;
        }

        case 'partial': {
          const partialData = message.data;
          const msgId = partialData.messageId ?? undefined;

          // Finalize previous message if SDK message ID changed (same as assistant/toolStreaming)
          if (msgId) {
            checkAndFinalizeForNewMessageId(msgId);
          }

          const msg = ensureStreamingMessage(msgId);

          if (partialData.streamingThinking !== undefined) {
            msg.thinking = partialData.streamingThinking;
          }
          if (partialData.streamingText !== undefined) {
            msg.content = partialData.streamingText;
          }
          // Track thinking phase (but not once tools are present)
          if (!msg.toolCalls || msg.toolCalls.length === 0) {
            msg.isThinkingPhase = partialData.isThinking ?? false;
          }
          break;
        }

        case 'done': {
          const resultData = message.data;
          finalizeStreamingMessage();
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
          if (resultData.cache_creation_tokens !== undefined) {
            sessionStats.value.cacheCreationTokens = resultData.cache_creation_tokens;
          }
          if (resultData.cache_read_tokens !== undefined) {
            sessionStats.value.cacheReadTokens = resultData.cache_read_tokens;
          }
          if (resultData.num_turns !== undefined) {
            sessionStats.value.numTurns = resultData.num_turns;
          }
          if (resultData.context_window_size !== undefined) {
            sessionStats.value.contextWindowSize = resultData.context_window_size;
          }
          break;
        }

        case 'processing':
          isProcessing.value = message.isProcessing;
          break;

        case 'error':
          addErrorMessage(message.message);
          break;

        case 'sessionStarted':
          currentSessionId.value = message.sessionId;
          break;

        case 'storedSessions': {
          loadingMoreSessions.value = false;
          // First page: replace list. Pagination: append to list.
          const isFirstPage = message.isFirstPage ?? storedSessions.value.length === 0;
          if (isFirstPage) {
            storedSessions.value = message.sessions;
          } else {
            storedSessions.value = [...storedSessions.value, ...message.sessions];
          }
          hasMoreSessions.value = message.hasMore ?? false;
          nextSessionsOffset.value = message.nextOffset ?? message.sessions.length;
          break;
        }

        case 'sessionCleared':
          clearMessages();
          accessedFiles.value.clear();
          sessionStats.value = { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, numTurns: 0, contextWindowSize: 200000 };
          currentSessionId.value = null;
          selectedSessionId.value = null;
          currentResumedSessionId.value = null;
          hasMoreHistory.value = false;
          nextHistoryOffset.value = 0;
          loadingMoreHistory.value = false;
          break;

        case 'sessionRenamed':
          // Session rename acknowledged
          break;

        case 'toolStreaming': {
          const targetMsgId = message.messageId;
          currentRunningTool.value = message.tool.name;

          // Finalize previous message if SDK message ID changed
          checkAndFinalizeForNewMessageId(targetMsgId);

          // Ensure streaming message exists and add the tool
          ensureStreamingMessage(targetMsgId);
          addToolCall(message.tool);
          trackFileAccess(message.tool.name, message.tool.input);
          break;
        }

        case 'requestPermission': {
          // Add tool to streamingMessage ref
          const toolCall: ToolCall = {
            id: message.toolUseId,
            name: message.toolName,
            input: message.toolInput,
            status: 'awaiting_approval',
          };

          if (streamingMessage.value) {
            if (!streamingMessage.value.toolCalls) {
              streamingMessage.value.toolCalls = [];
            }
            if (!streamingMessage.value.toolCalls.find((t: ToolCall) => t.id === message.toolUseId)) {
              streamingMessage.value.toolCalls.push(toolCall);
            }
          } else {
            streamingMessage.value = {
              id: `permission-${message.toolUseId}`,
              role: 'assistant',
              content: '',
              toolCalls: [toolCall],
              timestamp: Date.now(),
              isPartial: true,
            };
          }

          trackFileAccess(message.toolName, message.toolInput);

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
          switch (message.notificationType) {
            case 'success':
              toast.success(message.message);
              break;
            case 'error':
              toast.error(message.message);
              break;
            case 'warning':
              toast.warning(message.message);
              break;
            default:
              toast.info(message.message);
          }
          break;

        case 'accountInfo':
          accountInfo.value = message.data;
          break;

        case 'availableModels':
          availableModels.value = message.models;
          break;

        case 'settingsUpdate':
          currentSettings.value = message.settings;
          break;

        case 'mcpServerStatus':
          mcpServers.value = message.servers;
          break;

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

        case 'toolCompleted':
          updateToolStatus(message.toolUseId, 'completed', message.result);
          currentRunningTool.value = null;
          break;

        case 'toolFailed':
          updateToolStatus(message.toolUseId, 'failed', undefined, message.error);
          currentRunningTool.value = null;
          break;

        case 'toolAbandoned':
          updateToolStatus(message.toolUseId, 'abandoned');
          break;

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

        case 'compactBoundary':
          compactMarkers.value.push({
            id: generateId(),
            timestamp: Date.now(),
            trigger: message.trigger,
            preTokens: message.preTokens,
          });
          break;

        case 'checkpointInfo':
          checkpointMessages.value = new Set(message.checkpoints.map((cp: { userMessageId: string }) => cp.userMessageId));
          break;

        case 'rewindComplete':
          toast.success('Files rewound successfully');
          break;

        case 'rewindError':
          toast.error(`Rewind failed: ${message.message}`);
          break;

        case 'userReplay':
          addUserMessage(message.content, true);
          break;

        case 'assistantReplay': {
          messages.value.push({
            id: generateId(),
            role: 'assistant',
            content: message.content,
            thinking: message.thinking,
            toolCalls: convertHistoryTools(message.tools),
            timestamp: Date.now(),
            isReplay: true,
          });
          break;
        }

        case 'historyChunk': {
          loadingMoreHistory.value = false;
          hasMoreHistory.value = message.hasMore;
          nextHistoryOffset.value = message.nextOffset;

          if (message.messages.length > 0) {
            const container = messageContainerRef.value;
            const previousScrollHeight = container?.scrollHeight || 0;

            const olderMessages: ChatMessage[] = message.messages.map((msg: HistoryMessage) => ({
              id: generateId(),
              role: msg.type,
              content: msg.content,
              thinking: msg.thinking,
              toolCalls: convertHistoryTools(msg.tools),
              timestamp: Date.now(),
              isReplay: true,
            }));

            prependMessages(olderMessages);

            nextTick(() => {
              if (container) {
                const newScrollHeight = container.scrollHeight;
                container.scrollTop = newScrollHeight - previousScrollHeight;
              }
            });
          }
          break;
        }

        case 'sessionStart':
          // Could show a subtle indicator based on message.source
          break;

        case 'sessionEnd':
          isProcessing.value = false;
          break;
      }

      // Scroll to bottom on new messages
      nextTick(() => {
        const container = messageContainerRef.value;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    });

    // Notify extension that webview is ready
    postMessage({ type: 'ready' });

    // Auto-focus the chat input when panel opens
    nextTick(() => {
      chatInputRef.value?.focus();
    });
  });
}
