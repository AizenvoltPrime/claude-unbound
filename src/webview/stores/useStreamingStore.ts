import { ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  ChatMessage,
  ToolCall,
  ContentBlock,
} from '@shared/types';

export interface ToolStatusEntry {
  status: ToolCall['status'];
  result?: string;
  errorMessage?: string;
}

export const useStreamingStore = defineStore('streaming', () => {
  const messages = ref<ChatMessage[]>([]);
  const streamingMessage = ref<ChatMessage | null>(null);
  const toolStatusCache = ref<Map<string, ToolStatusEntry>>(new Map());

  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function finalizeStreamingMessage(): ChatMessage | null {
    if (!streamingMessage.value) return null;

    const finalized = {
      ...streamingMessage.value,
      isPartial: false,
      isThinkingPhase: false,
    };
    messages.value = [...messages.value, finalized];
    streamingMessage.value = null;
    return finalized;
  }

  function checkAndFinalizeForNewMessageId(newMsgId: string): boolean {
    if (streamingMessage.value &&
        streamingMessage.value.sdkMessageId &&
        streamingMessage.value.sdkMessageId !== newMsgId) {
      finalizeStreamingMessage();
      return true;
    }
    return false;
  }

  function ensureStreamingMessage(sdkMessageId?: string): ChatMessage {
    if (!streamingMessage.value) {
      streamingMessage.value = {
        id: `streaming-${Date.now()}`,
        sdkMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isPartial: true,
        isThinkingPhase: !sdkMessageId,
      };
    } else if (sdkMessageId && !streamingMessage.value.sdkMessageId) {
      streamingMessage.value = {
        ...streamingMessage.value,
        sdkMessageId,
      };
    } else if (sdkMessageId && streamingMessage.value.sdkMessageId &&
               streamingMessage.value.sdkMessageId !== sdkMessageId) {
      console.warn(
        '[useStreamingStore] ID mismatch detected - caller should have called ' +
        'checkAndFinalizeForNewMessageId() first. Current:', streamingMessage.value.sdkMessageId,
        'New:', sdkMessageId
      );
    }
    return streamingMessage.value;
  }

  function updateToolStatus(
    toolUseId: string,
    status: ToolCall['status'],
    result?: string,
    errorMessage?: string
  ): void {
    toolStatusCache.value.set(toolUseId, { status, result, errorMessage });

    if (streamingMessage.value?.toolCalls) {
      const toolIndex = streamingMessage.value.toolCalls.findIndex(t => t.id === toolUseId);
      if (toolIndex !== -1) {
        const updatedToolCalls = [...streamingMessage.value.toolCalls];
        updatedToolCalls[toolIndex] = {
          ...updatedToolCalls[toolIndex],
          status,
          ...(result !== undefined && { result }),
          ...(errorMessage !== undefined && { errorMessage }),
        };
        streamingMessage.value = {
          ...streamingMessage.value,
          toolCalls: updatedToolCalls,
        };
        return;
      }
    }

    for (let i = 0; i < messages.value.length; i++) {
      const msg = messages.value[i];
      if (msg.toolCalls) {
        const toolIndex = msg.toolCalls.findIndex(t => t.id === toolUseId);
        if (toolIndex !== -1) {
          const updatedToolCalls = [...msg.toolCalls];
          updatedToolCalls[toolIndex] = {
            ...updatedToolCalls[toolIndex],
            status,
            ...(result !== undefined && { result }),
            ...(errorMessage !== undefined && { errorMessage }),
          };
          const newMessages = [...messages.value];
          newMessages[i] = { ...msg, toolCalls: updatedToolCalls };
          messages.value = newMessages;
          break;
        }
      }
    }
  }

  function addToolCall(tool: { id: string; name: string; input: Record<string, unknown> }): void {
    const msg = ensureStreamingMessage();
    const existingToolCalls = msg.toolCalls || [];

    if (existingToolCalls.find(t => t.id === tool.id)) {
      return;
    }

    const cached = toolStatusCache.value.get(tool.id);
    const newToolCall: ToolCall = {
      id: tool.id,
      name: tool.name,
      input: tool.input,
      status: cached?.status ?? 'pending',
      result: cached?.result,
      errorMessage: cached?.errorMessage,
    };

    if (cached) {
      toolStatusCache.value.delete(tool.id);
    }

    streamingMessage.value = {
      ...msg,
      toolCalls: [...existingToolCalls, newToolCall],
      isThinkingPhase: false,
    };
  }

  function mergeToolCalls(existing: ToolCall[] | undefined, incoming: ToolCall[]): ToolCall[] {
    const statusPriority: Record<ToolCall['status'], number> = {
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
          };
        }
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

  function addUserMessage(content: string, isReplay = false, sdkMessageId?: string): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      sdkMessageId,
      role: 'user',
      content,
      timestamp: Date.now(),
      isReplay,
    };
    messages.value = [...messages.value, msg];
    return msg;
  }

  function addErrorMessage(error: string): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      role: 'error',
      content: error,
      timestamp: Date.now(),
    };
    messages.value = [...messages.value, msg];
    return msg;
  }

  function prependMessages(olderMessages: ChatMessage[]): void {
    messages.value = [...olderMessages, ...messages.value];
  }

  /**
   * Truncate all messages starting from the message with the given SDK message ID.
   * Used for conversation rewind - removes the target message and all that came after.
   * @param sdkMessageId The SDK message UUID to truncate from
   * @returns The content of the removed message for prefilling input, or null if not found
   */
  function truncateFromSdkMessageId(sdkMessageId: string): string | null {
    const index = messages.value.findIndex(m => m.sdkMessageId === sdkMessageId);
    if (index === -1) {
      console.warn('[useStreamingStore] Could not find message with SDK ID for truncation:', sdkMessageId);
      return null;
    }
    const removedMessage = messages.value[index];
    const content = removedMessage.content;
    messages.value = messages.value.slice(0, index);
    streamingMessage.value = null;
    return content;
  }

  function addMessage(message: Omit<ChatMessage, 'id'>): ChatMessage {
    const msg: ChatMessage = { id: generateId(), ...message };
    messages.value = [...messages.value, msg];
    return msg;
  }

  function assignSdkIdToLastUserMessage(sdkMessageId: string): void {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const msg = messages.value[i];
      if (msg.role === 'user') {
        if (msg.sdkMessageId !== sdkMessageId) {
          console.log('[useStreamingStore] Updating SDK ID for user message at index', i, 'from', msg.sdkMessageId, 'to', sdkMessageId);
          const newMessages = [...messages.value];
          newMessages[i] = { ...msg, sdkMessageId };
          messages.value = newMessages;
        }
        return;
      }
    }
    console.warn('[useStreamingStore] No user message found to assign SDK ID');
  }

  function $reset() {
    messages.value = [];
    streamingMessage.value = null;
    toolStatusCache.value = new Map();
  }

  return {
    messages,
    streamingMessage,
    toolStatusCache,
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
    prependMessages,
    addMessage,
    truncateFromSdkMessageId,
    assignSdkIdToLastUserMessage,
    $reset,
  };
});
