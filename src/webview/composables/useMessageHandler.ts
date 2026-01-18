import { onMounted, nextTick } from "vue";
import type { Ref, ComponentPublicInstance } from "vue";
import { toast } from "vue-sonner";
import { useVSCode } from "./useVSCode";
import { useUIStore } from "@/stores/useUIStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSessionStore } from "@/stores/useSessionStore";
import { usePermissionStore } from "@/stores/usePermissionStore";
import { useStreamingStore } from "@/stores/useStreamingStore";
import { useSubagentStore } from "@/stores/useSubagentStore";
import { useQuestionStore } from "@/stores/useQuestionStore";
import { usePlanViewStore } from "@/stores/usePlanViewStore";
import { applyLocale, i18n } from "@/i18n";
import {
  FEEDBACK_MARKER,
  type ChatMessage,
  type ToolCall,
  type TodoItem,
  type HistoryMessage,
  type HistoryToolCall,
} from "@shared/types";

function parseTodosFromInput(input: Record<string, unknown>): TodoItem[] | undefined {
  const typed = input as { todos?: Array<{ content: string; status: string; activeForm: string }> };
  if (!typed.todos) return undefined;
  return typed.todos.map(t => ({
    content: t.content,
    status: t.status as TodoItem['status'],
    activeForm: t.activeForm,
  }));
}

function extractUserDenialFeedback(errorMessage: string): string | undefined {
  if (!errorMessage.includes(FEEDBACK_MARKER)) return undefined;
  const markerIndex = errorMessage.indexOf(FEEDBACK_MARKER);
  return errorMessage.slice(markerIndex + FEEDBACK_MARKER.length).trim();
}

export interface MessageHandlerOptions {
  messageContainerRef: Ref<HTMLElement | null>;
  chatInputRef: Ref<ComponentPublicInstance<{ focus: () => void; setInput: (value: string) => void }> | null>;
}

function convertHistoryTools(tools: HistoryToolCall[] | undefined): ToolCall[] | undefined {
  return tools?.map((t) => ({
    id: t.id,
    name: t.name,
    input: t.input,
    status: t.isError ? "denied" as const : "completed" as const,
    result: t.result,
    isError: t.isError,
    metadata: t.metadata,
    feedback: t.feedback,
  }));
}

export function useMessageHandler(options: MessageHandlerOptions): void {
  const { postMessage, onMessage, setState, getState } = useVSCode();
  const { messageContainerRef, chatInputRef } = options;

  const uiStore = useUIStore();
  const settingsStore = useSettingsStore();
  const sessionStore = useSessionStore();
  const permissionStore = usePermissionStore();
  const streamingStore = useStreamingStore();
  const subagentStore = useSubagentStore();
  const questionStore = useQuestionStore();
  const planViewStore = usePlanViewStore();

  onMounted(() => {
    onMessage((message) => {
      let forceScrollToBottom = false;

      switch (message.type) {
        case "userMessage":
          streamingStore.addUserMessage(
            message.contentBlocks ?? message.content,
            false,
            undefined,
            undefined,
            message.correlationId
          );
          forceScrollToBottom = true;
          break;

        case "userMessageIdAssigned":
          streamingStore.assignSdkIdByCorrelationId(message.correlationId, message.sdkMessageId);
          break;

        case "assistant": {
          const assistantMsg = message.data;
          const msgId = assistantMsg.message.id;
          const parentToolUseId = message.parentToolUseId;
          const textContent = streamingStore.extractTextFromContent(assistantMsg.message.content);
          const toolCalls = streamingStore.extractToolCalls(assistantMsg.message.content);
          const thinkingContent = streamingStore.extractThinkingContent(assistantMsg.message.content);
          const hasSubagent = parentToolUseId ? subagentStore.hasSubagent(parentToolUseId) : false;

          for (const tool of toolCalls) {
            sessionStore.trackFileAccess(tool.name, tool.input);
          }

          if (parentToolUseId && hasSubagent) {
            const subagentContentBlocks = assistantMsg.message.content.filter(
              (block): block is
                | { type: 'text'; text: string }
                | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
                | { type: 'thinking'; thinking: string } =>
                block.type === 'text' || block.type === 'tool_use' || block.type === 'thinking'
            );
            const subagentToolCalls = subagentStore.buildToolCallsWithStatus(parentToolUseId, subagentContentBlocks);
            const subagentMsg: ChatMessage = {
              id: streamingStore.generateId(),
              sdkMessageId: msgId,
              role: "assistant",
              content: textContent,
              contentBlocks: subagentContentBlocks.length > 0 ? subagentContentBlocks : undefined,
              toolCalls: subagentToolCalls.length > 0 ? subagentToolCalls : undefined,
              timestamp: Date.now(),
              parentToolUseId,
            };
            subagentStore.addMessageToSubagent(parentToolUseId, subagentMsg);
            sessionStore.setCurrentSession(assistantMsg.session_id);
            break;
          }

          const contentBlocks = assistantMsg.message.content.filter(
            (block): block is { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
              block.type === 'text' || block.type === 'tool_use'
          );

          streamingStore.checkAndFinalizeForNewMessageId(msgId);
          const currentMsg = streamingStore.ensureStreamingMessage(msgId);

          const updates: Partial<ChatMessage> = {};
          if (textContent) {
            updates.content = textContent;
          }
          if (contentBlocks.length > 0) {
            updates.contentBlocks = contentBlocks;
          }
          if (thinkingContent) {
            updates.thinking = thinkingContent;
          }
          if (toolCalls.length > 0) {
            updates.toolCalls = streamingStore.mergeToolCalls(currentMsg.toolCalls, toolCalls);
          }
          if (toolCalls.length > 0 || textContent) {
            updates.isThinkingPhase = false;
          }
          if (Object.keys(updates).length > 0) {
            streamingStore.updateStreamingMessage(updates);
          }

          sessionStore.setCurrentSession(assistantMsg.session_id);
          break;
        }

        case "partial": {
          const partialData = message.data;
          const msgId = partialData.messageId ?? undefined;
          const parentToolUseId = message.parentToolUseId;

          if (parentToolUseId && subagentStore.hasSubagent(parentToolUseId) && msgId) {
            subagentStore.updateSubagentStreaming(parentToolUseId, msgId, {
              content: partialData.streamingText,
              thinking: partialData.streamingThinking,
              thinkingDuration: partialData.thinkingDuration,
              isThinkingPhase: partialData.isThinking,
            });
            break;
          }

          if (msgId) {
            streamingStore.checkAndFinalizeForNewMessageId(msgId);
          }

          const currentMsg = streamingStore.ensureStreamingMessage(msgId);

          const updates: Partial<ChatMessage> = {};
          if (partialData.streamingThinking !== undefined) {
            updates.thinking = partialData.streamingThinking;
          }
          if (partialData.streamingText !== undefined) {
            updates.content = partialData.streamingText;
          }
          if (partialData.thinkingDuration !== undefined) {
            updates.thinkingDuration = partialData.thinkingDuration;
          }
          if (!currentMsg.toolCalls || currentMsg.toolCalls.length === 0) {
            updates.isThinkingPhase = partialData.isThinking ?? false;
          }
          if (Object.keys(updates).length > 0) {
            streamingStore.updateStreamingMessage(updates);
          }
          break;
        }

        case "done": {
          const resultData = message.data;
          streamingStore.finalizeStreamingMessage();
          sessionStore.updateStats({
            ...(resultData.total_cost_usd !== undefined && { totalCostUsd: resultData.total_cost_usd }),
            ...(resultData.total_output_tokens !== undefined && { totalOutputTokens: resultData.total_output_tokens }),
            ...(resultData.num_turns !== undefined && { numTurns: resultData.num_turns }),
            ...(resultData.context_window_size !== undefined && { contextWindowSize: resultData.context_window_size }),
          });
          if (resultData.session_id) {
            sessionStore.setResumedSession(resultData.session_id);
          }
          break;
        }

        case "tokenUsageUpdate":
          sessionStore.updateStats({
            totalInputTokens: message.inputTokens,
            cacheCreationTokens: message.cacheCreationTokens,
            cacheReadTokens: message.cacheReadTokens,
          });
          break;

        case "processing":
          uiStore.setProcessing(message.isProcessing);
          if (!message.isProcessing && streamingStore.streamingMessageId) {
            streamingStore.finalizeStreamingMessage();
          }
          break;

        case "error":
          streamingStore.addErrorMessage(message.message);
          break;

        case "sessionStarted":
          sessionStore.setCurrentSession(message.sessionId);
          sessionStore.setSelectedSession(message.sessionId);
          setState({ ...getState(), sessionId: message.sessionId });
          break;

        case "storedSessions": {
          const isFirstPage = message.isFirstPage ?? sessionStore.storedSessions.length === 0;
          sessionStore.updateStoredSessions(
            message.sessions,
            isFirstPage,
            message.hasMore ?? false,
            message.nextOffset ?? message.sessions.length
          );
          return;
        }

        case "sessionCleared":
          streamingStore.$reset();
          subagentStore.$reset();
          questionStore.$reset();
          permissionStore.$reset();
          planViewStore.$reset();
          sessionStore.clearSessionData();
          sessionStore.setCurrentSession(null);
          sessionStore.setSelectedSession(null);
          sessionStore.setResumedSession(null);
          uiStore.setTodosPanelCollapsed(true);
          if (message.pendingMessage) {
            streamingStore.addUserMessage(message.pendingMessage.content, false, undefined, undefined, message.pendingMessage.correlationId);
            uiStore.setProcessing(true);
            forceScrollToBottom = true;
          }
          break;

        case "conversationCleared":
          streamingStore.$reset();
          subagentStore.$reset();
          questionStore.$reset();
          permissionStore.$reset();
          planViewStore.$reset();
          sessionStore.clearSessionData();
          uiStore.setProcessing(false);
          uiStore.setTodosPanelCollapsed(true);
          toast.success(i18n.global.t('toast.conversationCleared'));
          break;

        case "sessionRenamed":
          break;

        case "toolStreaming": {
          const targetMsgId = message.messageId;
          const parentToolUseId = message.parentToolUseId;
          uiStore.setCurrentRunningTool(message.tool.name);
          const hasSubagent = parentToolUseId ? subagentStore.hasSubagent(parentToolUseId) : false;

          if (message.tool.name === "Task") {
            subagentStore.registerTaskTool(
              message.tool.id,
              message.tool.input as { description?: string; prompt?: string; subagent_type?: string }
            );
          }

          const parsedTodos = message.tool.name === "TodoWrite"
            ? parseTodosFromInput(message.tool.input)
            : undefined;

          if (parsedTodos) {
            sessionStore.updateTodos(parsedTodos);
            uiStore.setTodosPanelCollapsed(false);
          }

          if (parentToolUseId && hasSubagent) {
            const toolCall: ToolCall = {
              id: message.tool.id,
              name: message.tool.name,
              input: message.tool.input,
              status: "running",
            };
            subagentStore.addToolCallToSubagent(parentToolUseId, toolCall);
            sessionStore.trackFileAccess(message.tool.name, message.tool.input);
            break;
          }

          streamingStore.checkAndFinalizeForNewMessageId(targetMsgId);
          streamingStore.ensureStreamingMessage(targetMsgId);
          streamingStore.addToolCall(message.tool, message.contentBlocks);
          sessionStore.trackFileAccess(message.tool.name, message.tool.input);
          break;
        }

        case "toolPending": {
          const found = subagentStore.updateSubagentToolStatus(message.toolUseId, "running");
          if (!found) {
            streamingStore.updateToolStatus(message.toolUseId, "running");
          }
          break;
        }

        case "toolMetadata": {
          const found = subagentStore.updateSubagentToolMetadata(message.toolUseId, message.metadata);
          if (!found) {
            streamingStore.updateToolMetadata(message.toolUseId, message.metadata);
          }
          break;
        }

        case "requestPermission": {
          const parentToolUseId = message.parentToolUseId;
          const toolCall: ToolCall = {
            id: message.toolUseId,
            name: message.toolName,
            input: message.toolInput,
            status: "awaiting_approval",
            metadata: message.editLineNumber ? { editLineNumber: message.editLineNumber } : undefined,
          };

          if (message.toolName === "Edit" || message.toolName === "Write") {
            sessionStore.trackFileAccess(message.toolName, message.toolInput);
          }

          if (parentToolUseId && subagentStore.hasSubagent(parentToolUseId)) {
            subagentStore.addToolCallToSubagent(parentToolUseId, toolCall);
          } else {
            streamingStore.addToolCall({
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
              metadata: toolCall.metadata,
            });
            streamingStore.updateToolStatus(toolCall.id, "awaiting_approval");
          }

          const agentDescription = parentToolUseId ? subagentStore.getSubagentDescription(parentToolUseId) : undefined;

          permissionStore.addPermission(message.toolUseId, {
            toolName: message.toolName,
            filePath: message.filePath,
            originalContent: message.originalContent,
            proposedContent: message.proposedContent,
            command: message.command,
            parentToolUseId,
            agentDescription,
          });
          break;
        }

        case "requestQuestion": {
          const parentToolUseId = message.parentToolUseId;
          const agentDescription = parentToolUseId ? subagentStore.getSubagentDescription(parentToolUseId) : undefined;

          questionStore.setQuestion({
            toolUseId: message.toolUseId,
            questions: message.questions,
            parentToolUseId,
            agentDescription,
          });
          break;
        }

        case "requestPlanApproval":
          permissionStore.setPendingPlanApproval({
            toolUseId: message.toolUseId,
            planContent: message.planContent,
          });
          break;

        case "requestEnterPlanMode":
          permissionStore.setPendingEnterPlanApproval({
            toolUseId: message.toolUseId,
          });
          break;

        case "requestSkillApproval":
          permissionStore.setPendingSkillApproval({
            toolUseId: message.toolUseId,
            skillName: message.skillName,
            skillDescription: message.skillDescription,
          });
          if (message.skillDescription) {
            streamingStore.updateToolMetadata(message.toolUseId, {
              skillDescription: message.skillDescription,
            });
          }
          break;

        case "notification":
          switch (message.notificationType) {
            case "success":
              toast.success(message.message);
              break;
            case "error":
              toast.error(message.message);
              break;
            case "warning":
              toast.warning(message.message);
              break;
            default:
              toast.info(message.message);
          }
          break;

        case "accountInfo":
          settingsStore.setAccountInfo(message.data);
          break;

        case "availableModels":
          settingsStore.setAvailableModels(message.models);
          break;

        case "settingsUpdate":
          settingsStore.updateSettings(message.settings);
          break;

        case "mcpServerStatus":
        case "mcpConfigUpdate":
          settingsStore.setMcpServers(message.servers);
          break;

        case "pluginStatus":
        case "pluginConfigUpdate":
          settingsStore.setPlugins(message.plugins);
          break;

        case "providerProfilesUpdate":
          settingsStore.setProviderProfiles(message.profiles, message.activeProfile, message.defaultProfile);
          break;

        case "systemInit":
          if (message.data.mcpServers) {
            settingsStore.updateMcpServerStatuses(message.data.mcpServers);
          }
          if (message.data.plugins) {
            settingsStore.updatePluginStatuses(message.data.plugins);
          }
          break;

        case "budgetWarning":
          settingsStore.setBudgetWarning(message.currentSpend, message.limit, false);
          break;

        case "budgetExceeded":
          settingsStore.setBudgetWarning(message.finalSpend, message.limit, true);
          break;

        case "toolCompleted": {
          const found = subagentStore.updateSubagentToolStatus(message.toolUseId, "completed", message.result);
          if (!found) {
            streamingStore.updateToolStatus(message.toolUseId, "completed", { result: message.result });
          }
          if (message.toolName === "Task" && subagentStore.hasSubagent(message.toolUseId)) {
            subagentStore.completeSubagent(message.toolUseId);
            try {
              const parsed = JSON.parse(message.result);
              const contentItems = parsed.content as Array<{ type: string; text?: string }> | undefined;
              const contentText =
                contentItems
                  ?.filter((item) => item.type === "text" && item.text)
                  .map((item) => item.text)
                  .join("\n") || "";
              subagentStore.setSubagentResult(message.toolUseId, {
                content: contentText,
                totalDurationMs: parsed.totalDurationMs,
                totalTokens: parsed.totalTokens,
                totalToolUseCount: parsed.totalToolUseCount,
                sdkAgentId: parsed.agentId,
              });
            } catch {
              console.warn("[useMessageHandler] Failed to parse Task tool result");
            }
          }
          uiStore.setCurrentRunningTool(null);
          break;
        }

        case "toolFailed": {
          const feedback = extractUserDenialFeedback(message.error);
          const isUserDenial = feedback !== undefined;
          const status = isUserDenial ? "denied" : "failed";

          const found = subagentStore.updateSubagentToolStatus(message.toolUseId, status, undefined, message.error);
          if (!found) {
            streamingStore.updateToolStatus(message.toolUseId, status, {
              errorMessage: message.error,
              feedback,
            });
          }
          if (message.toolName === "Task" && subagentStore.hasSubagent(message.toolUseId)) {
            subagentStore.failSubagent(message.toolUseId);
          }
          uiStore.setCurrentRunningTool(null);
          break;
        }

        case "toolAbandoned": {
          const found = subagentStore.updateSubagentToolStatus(message.toolUseId, "abandoned");
          if (!found) {
            streamingStore.updateToolStatus(message.toolUseId, "abandoned");
          }
          break;
        }

        case "subagentStart":
          subagentStore.startSubagent(message.agentId, message.agentType, message.toolUseId);
          break;

        case "subagentStop":
          subagentStore.stopSubagent(message.agentId);
          break;

        case "subagentModelUpdate":
          subagentStore.updateSubagentModel(message.taskToolId, message.model);
          break;

        case "subagentMessagesUpdate":
          subagentStore.replaceSubagentMessages(message.taskToolId, message.messages);
          break;

        case "sessionCancelled":
          if (!uiStore.isProcessing && !streamingStore.streamingMessageId) {
            break;
          }
          uiStore.setProcessing(false);
          if (streamingStore.streamingMessageId) {
            streamingStore.finalizeStreamingMessage();
          }
          subagentStore.cancelRunningSubagents();
          questionStore.$reset();
          permissionStore.$reset();
          break;

        case "interruptRecovery": {
          const removedContent = streamingStore.removeMessageByCorrelationId(message.correlationId);
          const contentToRecover = removedContent ?? message.promptContent;
          if (contentToRecover) {
            chatInputRef.value?.setInput(contentToRecover);
            toast.info(i18n.global.t('toast.interrupted'));
          }
          break;
        }

        case "compactBoundary": {
          if (!message.isHistorical) {
            sessionStore.clearCompactMarkers();
          }
          const compactMessage = [...streamingStore.messages]
            .reverse()
            .find(m => m.role === 'user' && m.content.trim().toLowerCase().startsWith('/compact'));
          const cutoffTimestamp = compactMessage?.timestamp;
          sessionStore.addCompactMarker(message.trigger, message.preTokens, message.postTokens, message.summary, message.timestamp, cutoffTimestamp);
          break;
        }

        case "compactSummary": {
          const markers = sessionStore.compactMarkers;
          const lastMarker = markers.length > 0 ? markers[markers.length - 1] : null;
          if (lastMarker) {
            const cutoff = lastMarker.messageCutoffTimestamp ?? lastMarker.timestamp;
            streamingStore.truncateMessagesBeforeTimestamp(cutoff);
          }
          sessionStore.updateLastCompactMarkerSummary(message.summary);
          break;
        }

        case "todosUpdate":
          sessionStore.updateTodos(message.todos);
          break;

        case "checkpointInfo":
          sessionStore.setCheckpointMessages(message.checkpoints.map((cp: { userMessageId: string }) => cp.userMessageId));
          break;

        case "rewindHistory":
          uiStore.setRewindHistory(message.prompts);
          break;

        case "rewindComplete": {
          const option = message.option;
          const truncateConversation = option === 'code-and-conversation' || option === 'conversation-only';

          if (truncateConversation) {
            subagentStore.$reset();
            sessionStore.updateTodos([]);
            uiStore.setTodosPanelCollapsed(true);

            // Use bulletproof truncation that tries sdkMessageId first, then content matching
            const removedContent = streamingStore.truncateToMessage(message.rewindToMessageId, message.promptContent);
            if (removedContent !== null) {
              chatInputRef.value?.setInput(removedContent);
              if (option === 'code-and-conversation') {
                toast.success(i18n.global.t('toast.rewindBoth'));
              } else {
                toast.success(i18n.global.t('toast.rewindConversation'));
              }
            } else {
              toast.warning(i18n.global.t('toast.truncateFailed'));
              if (option === 'code-and-conversation') {
                toast.success(i18n.global.t('toast.rewindFilesPartial'));
              }
            }
          } else {
            toast.success(i18n.global.t('toast.rewindFiles'));
          }
          break;
        }

        case "rewindError":
          toast.error(i18n.global.t('toast.rewindFailed', { message: message.message }));
          break;

        case "userReplay":
          streamingStore.addUserMessage(
            message.contentBlocks ?? message.content,
            true,
            message.sdkMessageId,
            message.isInjected
          );
          break;

        case "assistantReplay": {
          if (message.tools) {
            for (const tool of message.tools) {
              if (tool.name === "Task") {
                subagentStore.restoreSubagentFromHistory(tool);
              }
              if (tool.name === "TodoWrite") {
                const todos = parseTodosFromInput(tool.input);
                if (todos) {
                  sessionStore.updateTodos(todos);
                }
              }
            }
          }
          streamingStore.addMessage({
            role: "assistant",
            content: message.content,
            thinking: message.thinking,
            toolCalls: convertHistoryTools(message.tools),
            timestamp: Date.now(),
            isReplay: true,
          });
          break;
        }

        case "errorReplay": {
          streamingStore.addMessage({
            role: "error",
            content: message.content,
            timestamp: Date.now(),
            isReplay: true,
          });
          break;
        }

        case "historyChunk": {
          sessionStore.updateHistoryPagination(message.hasMore, message.nextOffset);

          if (message.messages.length > 0) {
            const container = messageContainerRef.value;
            const previousScrollHeight = container?.scrollHeight || 0;

            for (const msg of message.messages) {
              if (msg.tools) {
                for (const tool of msg.tools) {
                  if (tool.name === "Task") {
                    subagentStore.restoreSubagentFromHistory(tool);
                  }
                }
              }
            }

            const olderMessages: ChatMessage[] = message.messages.map((msg: HistoryMessage) => ({
              id: streamingStore.generateId(),
              sdkMessageId: msg.sdkMessageId,
              role: msg.type,
              content: msg.content,
              contentBlocks: msg.contentBlocks,
              thinking: msg.thinking,
              toolCalls: convertHistoryTools(msg.tools),
              timestamp: Date.now(),
              isReplay: true,
              isInjected: msg.isInjected,
            }));

            streamingStore.prependMessages(olderMessages);

            nextTick(() => {
              if (container) {
                const newScrollHeight = container.scrollHeight;
                container.scrollTop = newScrollHeight - previousScrollHeight;
              }
            });
          }
          break;
        }

        case "sessionStart":
          break;

        case "sessionEnd":
          uiStore.setProcessing(false);
          break;

        case "panelFocused":
          nextTick(() => {
            chatInputRef.value?.focus();
          });
          return;

        case "messageQueued":
          streamingStore.addQueuedMessage(message.message);
          break;

        case "queueProcessed":
          streamingStore.markQueueProcessed(message.messageId);
          break;

        case "queueBatchProcessed":
          streamingStore.combineQueuedMessages(message.messageIds, message.combinedContent, message.contentBlocks);
          break;

        case "queueCancelled":
          streamingStore.removeQueuedMessage(message.messageId);
          break;

        case "flushedMessagesAssigned":
          streamingStore.assignSdkIdToFlushedMessage(message.queueMessageIds, message.sdkMessageId);
          break;

        case "ideContextUpdate":
          uiStore.setIdeContext(message.context);
          break;

        case "languageChange":
          applyLocale(message.locale);
          break;

        case "showPlanContent":
          planViewStore.setViewingPlan(message.content, message.filePath);
          break;
      }

      nextTick(() => {
        const container = messageContainerRef.value;
        if (container && (forceScrollToBottom || uiStore.isAtBottom)) {
          container.scrollTop = container.scrollHeight;
        }
      });
    });

    const savedState = getState<{ sessionId?: string }>();
    postMessage({ type: "ready", savedSessionId: savedState?.sessionId });

    nextTick(() => {
      chatInputRef.value?.focus();
    });
  });
}
