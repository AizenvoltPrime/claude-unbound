import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { ChatMessage, ToolCall, ContentBlock, QueuedMessage, UserContentBlock } from "@shared/types";

export interface ToolStatusEntry {
  status: ToolCall["status"];
  result?: string;
  errorMessage?: string;
  feedback?: string;
}

export const useStreamingStore = defineStore("streaming", () => {
  const messages = ref<ChatMessage[]>([]);
  const streamingMessageId = ref<string | null>(null);
  const toolStatusCache = ref<Map<string, ToolStatusEntry>>(new Map());
  const expandedMcpToolId = ref<string | null>(null);

  const expandedMcpTool = computed<ToolCall | undefined>(() => {
    if (!expandedMcpToolId.value) return undefined;
    for (const msg of messages.value) {
      const tool = msg.toolCalls?.find((t) => t.id === expandedMcpToolId.value);
      if (tool) return tool;
    }
    return undefined;
  });

  function expandMcpTool(toolId: string): void {
    expandedMcpToolId.value = toolId;
  }

  function collapseMcpTool(): void {
    expandedMcpToolId.value = null;
  }

  const streamingMessage = computed<ChatMessage | null>(() => {
    if (!streamingMessageId.value) return null;
    return messages.value.find((m) => m.id === streamingMessageId.value) ?? null;
  });

  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function getStreamingMessageIndex(): number {
    if (!streamingMessageId.value) return -1;
    return messages.value.findIndex((m) => m.id === streamingMessageId.value);
  }

  function updateStreamingMessage(updates: Partial<ChatMessage>): void {
    const index = getStreamingMessageIndex();
    if (index === -1) return;

    const current = messages.value[index];
    const updated = { ...current, ...updates };
    const newMessages = [...messages.value];
    newMessages[index] = updated;
    messages.value = newMessages;
  }

  function finalizeStreamingMessage(): ChatMessage | null {
    const msg = streamingMessage.value;
    if (!msg) return null;

    updateStreamingMessage({
      isPartial: false,
      isThinkingPhase: false,
    });

    const finalized = streamingMessage.value;
    streamingMessageId.value = null;

    return finalized;
  }

  function checkAndFinalizeForNewMessageId(newMsgId: string): boolean {
    const current = streamingMessage.value;
    if (current?.sdkMessageId && current.sdkMessageId !== newMsgId) {
      finalizeStreamingMessage();
      return true;
    }
    return false;
  }

  function clearQueuedBadges(): void {
    const hasQueued = messages.value.some((m) => m.isQueued);
    if (hasQueued) {
      messages.value = messages.value.map((m) => (m.isQueued ? { ...m, isQueued: false } : m));
    }
  }

  function ensureStreamingMessage(sdkMessageId?: string): ChatMessage {
    const current = streamingMessage.value;

    if (!current) {
      const newMsg: ChatMessage = {
        id: `streaming-${Date.now()}`,
        sdkMessageId,
        role: "assistant",
        content: "",
        contentBlocks: [],
        timestamp: Date.now(),
        isPartial: true,
        isThinkingPhase: !sdkMessageId,
      };
      messages.value = [...messages.value, newMsg];
      streamingMessageId.value = newMsg.id;
      return newMsg;
    }

    if (sdkMessageId && !current.sdkMessageId) {
      updateStreamingMessage({ sdkMessageId });
      return streamingMessage.value!;
    }

    if (sdkMessageId && current.sdkMessageId && current.sdkMessageId !== sdkMessageId) {
      console.warn(
        "[useStreamingStore] ID mismatch detected - caller should have called " + "checkAndFinalizeForNewMessageId() first. Current:",
        current.sdkMessageId,
        "New:",
        sdkMessageId
      );
    }

    return current;
  }

  function updateToolStatus(
    toolUseId: string,
    status: ToolCall["status"],
    options?: { result?: string; errorMessage?: string; feedback?: string }
  ): void {
    toolStatusCache.value.set(toolUseId, { status, ...options });

    for (let i = 0; i < messages.value.length; i++) {
      const msg = messages.value[i];
      if (msg.toolCalls) {
        const toolIndex = msg.toolCalls.findIndex((t) => t.id === toolUseId);
        if (toolIndex !== -1) {
          const updatedToolCalls = [...msg.toolCalls];
          updatedToolCalls[toolIndex] = {
            ...updatedToolCalls[toolIndex],
            status,
            ...(options?.result !== undefined && { result: options.result }),
            ...(options?.errorMessage !== undefined && { errorMessage: options.errorMessage }),
            ...(options?.feedback !== undefined && { feedback: options.feedback }),
          };
          const newMessages = [...messages.value];
          newMessages[i] = { ...msg, toolCalls: updatedToolCalls };
          messages.value = newMessages;
          return;
        }
      }
    }
  }

  function updateToolMetadata(toolUseId: string, metadata: Record<string, unknown>): void {
    for (let i = 0; i < messages.value.length; i++) {
      const msg = messages.value[i];
      if (msg.toolCalls) {
        const toolIndex = msg.toolCalls.findIndex((t) => t.id === toolUseId);
        if (toolIndex !== -1) {
          const updatedToolCalls = [...msg.toolCalls];
          updatedToolCalls[toolIndex] = {
            ...updatedToolCalls[toolIndex],
            metadata: { ...updatedToolCalls[toolIndex].metadata, ...metadata },
          };
          const newMessages = [...messages.value];
          newMessages[i] = { ...msg, toolCalls: updatedToolCalls };
          messages.value = newMessages;
          return;
        }
      }
    }
  }

  function addToolCall(tool: { id: string; name: string; input: Record<string, unknown> }, contentBlocks?: ContentBlock[]): void {
    const msg = ensureStreamingMessage();
    const existingToolCalls = msg.toolCalls || [];

    if (existingToolCalls.find((t) => t.id === tool.id)) {
      return;
    }

    const cached = toolStatusCache.value.get(tool.id);
    const newToolCall: ToolCall = {
      id: tool.id,
      name: tool.name,
      input: tool.input,
      status: cached?.status ?? "pending",
      result: cached?.result,
      errorMessage: cached?.errorMessage,
      feedback: cached?.feedback,
    };

    if (cached) {
      toolStatusCache.value.delete(tool.id);
    }

    updateStreamingMessage({
      toolCalls: [...existingToolCalls, newToolCall],
      ...(contentBlocks && { contentBlocks }),
      isThinkingPhase: false,
    });
  }

  function mergeToolCalls(existing: ToolCall[] | undefined, incoming: ToolCall[]): ToolCall[] {
    const statusPriority: Record<ToolCall["status"], number> = {
      pending: 0,
      running: 1,
      awaiting_approval: 2,
      approved: 3,
      denied: 3,
      completed: 4,
      failed: 4,
      abandoned: 4,
    };

    const merged = new Map<string, ToolCall>();

    for (const tool of existing || []) {
      merged.set(tool.id, tool);
    }

    for (const tool of incoming) {
      const exists = merged.get(tool.id);
      if (!exists) {
        merged.set(tool.id, tool);
      } else if (statusPriority[tool.status] >= statusPriority[exists.status]) {
        merged.set(tool.id, { ...exists, ...tool });
      }
    }

    return Array.from(merged.values());
  }

  function extractTextFromContent(content: ContentBlock[]): string {
    return content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }

  function extractToolCalls(content: ContentBlock[]): ToolCall[] {
    return content
      .filter((block): block is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => block.type === "tool_use")
      .map((block) => {
        const cached = toolStatusCache.value.get(block.id);
        if (cached) {
          toolStatusCache.value.delete(block.id);
          return {
            id: block.id,
            name: block.name,
            input: block.input,
            status: cached.status,
            result: cached.result,
            errorMessage: cached.errorMessage,
            feedback: cached.feedback,
          };
        }
        return {
          id: block.id,
          name: block.name,
          input: block.input,
          status: "pending" as const,
        };
      });
  }

  function extractThinkingContent(content: ContentBlock[]): string | undefined {
    const thinkingBlocks = content.filter((block): block is { type: "thinking"; thinking: string } => block.type === "thinking");
    if (thinkingBlocks.length === 0) return undefined;
    return thinkingBlocks.map((block) => block.thinking).join("\n\n");
  }

  function addUserMessage(
    content: string | UserContentBlock[],
    isReplay = false,
    sdkMessageId?: string,
    isInjected?: boolean,
    correlationId?: string
  ): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      sdkMessageId,
      correlationId,
      role: "user",
      content: extractDisplayContent(content),
      contentBlocks: contentBlocksFromUserContent(content),
      timestamp: Date.now(),
      isReplay,
      isInjected,
    };
    messages.value = [...messages.value, msg];
    return msg;
  }

  function addErrorMessage(error: string): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      role: "error",
      content: error,
      timestamp: Date.now(),
    };
    messages.value = [...messages.value, msg];
    return msg;
  }

  function prependMessages(olderMessages: ChatMessage[]): void {
    messages.value = [...olderMessages, ...messages.value];
  }

  function truncateFromSdkMessageId(sdkMessageId: string): string | null {
    const index = messages.value.findIndex((m) => m.sdkMessageId === sdkMessageId);

    if (index === -1) {
      console.warn("[useStreamingStore] Could not find message with SDK ID for truncation:", sdkMessageId);
      return null;
    }
    const removedMessage = messages.value[index];
    const content = removedMessage.content;
    messages.value = messages.value.slice(0, index);
    streamingMessageId.value = null;
    return content;
  }

  /**
   * Truncation that tries multiple matching strategies:
   * 1. First try sdkMessageId (most reliable if assigned)
   * 2. Fall back to content matching for user messages
   * This ensures rewind works even when sdkMessageId wasn't properly linked.
   */
  function truncateToMessage(sdkMessageId: string, promptContent?: string): string | null {
    // Strategy 1: Find by sdkMessageId
    let index = messages.value.findIndex((m) => m.sdkMessageId === sdkMessageId);

    // Strategy 2: Fall back to content prefix matching for user messages
    // (promptContent may be truncated to 200 chars by history-manager)
    if (index === -1 && promptContent) {
      // Search backwards to find the most recent matching user message
      for (let i = messages.value.length - 1; i >= 0; i--) {
        const msg = messages.value[i];
        if (msg.role === "user" && msg.content.startsWith(promptContent)) {
          index = i;
          break;
        }
      }
    }

    if (index === -1) {
      console.warn(
        "[useStreamingStore] Could not find message for truncation. sdkMessageId:",
        sdkMessageId,
        "promptContent:",
        promptContent?.slice(0, 50)
      );
      return null;
    }

    const removedMessage = messages.value[index];
    const content = removedMessage.content;
    messages.value = messages.value.slice(0, index);
    streamingMessageId.value = null;
    return content;
  }

  function removeMessageByCorrelationId(correlationId: string): string | null {
    const index = messages.value.findIndex((m) => m.correlationId === correlationId);
    if (index === -1) return null;

    const removedMessage = messages.value[index];
    messages.value = messages.value.filter((_, i) => i !== index);
    return removedMessage.content;
  }

  function addMessage(message: Omit<ChatMessage, "id">): ChatMessage {
    const msg: ChatMessage = { id: generateId(), ...message };
    messages.value = [...messages.value, msg];
    return msg;
  }

  function assignSdkIdByCorrelationId(correlationId: string, sdkMessageId: string): void {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const msg = messages.value[i];
      if (msg.correlationId === correlationId) {
        if (msg.sdkMessageId !== sdkMessageId) {
          const newMessages = [...messages.value];
          newMessages[i] = { ...msg, sdkMessageId };
          messages.value = newMessages;
        }
        return;
      }
    }
  }

  function assignSdkIdToFlushedMessage(queueMessageIds: string[], sdkMessageId: string): void {
    if (queueMessageIds.length === 0) return;
    const primaryId = queueMessageIds[0];
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const msg = messages.value[i];
      if (msg.id === primaryId) {
        if (msg.sdkMessageId !== sdkMessageId) {
          const newMessages = [...messages.value];
          newMessages[i] = { ...msg, sdkMessageId };
          messages.value = newMessages;
        }
        return;
      }
    }
  }

  function extractDisplayContent(content: string | UserContentBlock[]): string {
    if (typeof content === "string") return content;
    const textBlocks = content.filter((b): b is { type: "text"; text: string } => b.type === "text");
    const imageCount = content.filter((b) => b.type === "image").length;
    const textContent = textBlocks.map((b) => b.text).join("\n");
    if (imageCount > 0 && !textContent) {
      return `[${imageCount} image${imageCount > 1 ? "s" : ""}]`;
    }
    return textContent;
  }

  function contentBlocksFromUserContent(content: string | UserContentBlock[]): ContentBlock[] | undefined {
    if (typeof content === "string") return undefined;
    return content;
  }

  function addQueuedMessage(message: QueuedMessage): void {
    const chatMessage: ChatMessage = {
      id: message.id,
      sdkMessageId: message.id,
      role: "user",
      content: extractDisplayContent(message.content),
      contentBlocks: contentBlocksFromUserContent(message.content),
      timestamp: message.timestamp,
      isQueued: true,
      isInjected: true,
    };
    messages.value = [...messages.value, chatMessage];
  }

  function markQueueProcessed(messageId: string): void {
    const index = messages.value.findIndex((m) => m.id === messageId);
    if (index !== -1) {
      const msg = messages.value[index];
      const newMessages = messages.value.filter((_, i) => i !== index);
      newMessages.push({ ...msg, isQueued: false });
      messages.value = newMessages;
    }
  }

  function removeQueuedMessage(messageId: string): void {
    messages.value = messages.value.filter((m) => m.id !== messageId);
  }

  function combineQueuedMessages(messageIds: string[], combinedContent: string, contentBlocks?: UserContentBlock[]): void {
    const idsSet = new Set(messageIds);
    const firstQueuedIndex = messages.value.findIndex((m) => idsSet.has(m.id));
    const timestamp = firstQueuedIndex !== -1 ? messages.value[firstQueuedIndex].timestamp : Date.now();

    messages.value = messages.value.filter((m) => !idsSet.has(m.id));

    const combinedMessage: ChatMessage = {
      id: messageIds[0],
      role: "user",
      content: combinedContent,
      contentBlocks,
      timestamp,
    };
    messages.value = [...messages.value, combinedMessage];
  }

  function appendStreamingContent(text: string): void {
    const current = streamingMessage.value;
    if (!current) return;
    updateStreamingMessage({
      content: current.content + text,
      isPartial: true,
    });
  }

  function appendStreamingThinking(thinking: string): void {
    const current = streamingMessage.value;
    if (!current) return;
    updateStreamingMessage({
      thinkingContent: (current.thinkingContent || "") + thinking,
      isThinkingPhase: true,
    });
  }

  function setStreamingThinkingPhase(isThinking: boolean): void {
    updateStreamingMessage({ isThinkingPhase: isThinking });
  }

  function $reset() {
    messages.value = [];
    streamingMessageId.value = null;
    toolStatusCache.value = new Map();
    expandedMcpToolId.value = null;
  }

  return {
    messages,
    streamingMessage,
    streamingMessageId,
    toolStatusCache,
    expandedMcpToolId,
    expandedMcpTool,
    expandMcpTool,
    collapseMcpTool,
    generateId,
    getStreamingMessageIndex,
    updateStreamingMessage,
    finalizeStreamingMessage,
    checkAndFinalizeForNewMessageId,
    clearQueuedBadges,
    ensureStreamingMessage,
    updateToolStatus,
    updateToolMetadata,
    addToolCall,
    mergeToolCalls,
    extractTextFromContent,
    extractToolCalls,
    extractThinkingContent,
    addUserMessage,
    addErrorMessage,
    prependMessages,
    addMessage,
    truncateFromSdkMessageId,
    truncateToMessage,
    removeMessageByCorrelationId,
    assignSdkIdByCorrelationId,
    assignSdkIdToFlushedMessage,
    addQueuedMessage,
    markQueueProcessed,
    removeQueuedMessage,
    combineQueuedMessages,
    appendStreamingContent,
    appendStreamingThinking,
    setStreamingThinkingPhase,
    $reset,
  };
});
