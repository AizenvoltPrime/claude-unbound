import { ref } from 'vue';
import type {
  ChatMessage,
  ToolCall,
  ContentBlock,
} from '@shared/types';

/**
 * Composable for managing streaming messages from the Claude SDK.
 *
 * Key concepts:
 * - `streamingMessage` is kept separate from `messages` array to prevent Vue reactivity flashes
 * - Each SDK message ID represents a distinct "turn" with its own thinking block
 * - Messages are only pushed to `messages` when finalized (done event or new message ID)
 */
export function useStreamingMessage() {
  const messages = ref<ChatMessage[]>([]);
  const streamingMessage = ref<ChatMessage | null>(null);
  const toolStatusCache = ref<Map<string, { status: ToolCall['status']; result?: string; errorMessage?: string }>>(new Map());

  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Finalize the current streaming message and push to messages array.
   * Called when SDK message ID changes or on 'done' event.
   */
  function finalizeStreamingMessage(): ChatMessage | null {
    if (!streamingMessage.value) return null;

    streamingMessage.value.isPartial = false;
    streamingMessage.value.isThinkingPhase = false;
    const finalized = streamingMessage.value;
    messages.value.push(finalized);
    streamingMessage.value = null;
    return finalized;
  }

  /**
   * Check if we need to finalize due to a new SDK message ID.
   * Returns true if finalization occurred.
   */
  function checkAndFinalizeForNewMessageId(newMsgId: string): boolean {
    if (streamingMessage.value &&
        streamingMessage.value.sdkMessageId &&
        streamingMessage.value.sdkMessageId !== newMsgId) {
      finalizeStreamingMessage();
      return true;
    }
    return false;
  }

  /**
   * Ensure a streaming message exists, creating one if needed.
   *
   * IMPORTANT: Callers should call checkAndFinalizeForNewMessageId() first when
   * they have an sdkMessageId, to properly handle message boundaries. This function
   * does not auto-finalize to keep state transitions explicit and debuggable.
   */
  function ensureStreamingMessage(sdkMessageId?: string): ChatMessage {
    if (!streamingMessage.value) {
      streamingMessage.value = {
        id: `streaming-${Date.now()}`,
        sdkMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isPartial: true,
        isThinkingPhase: !sdkMessageId, // If no ID yet, we're in thinking phase
      };
    } else if (sdkMessageId && !streamingMessage.value.sdkMessageId) {
      streamingMessage.value.sdkMessageId = sdkMessageId;
    } else if (sdkMessageId && streamingMessage.value.sdkMessageId &&
               streamingMessage.value.sdkMessageId !== sdkMessageId) {
      // Defense in depth: warn if caller forgot to check message boundaries
      console.warn(
        '[useStreamingMessage] ID mismatch detected - caller should have called ' +
        'checkAndFinalizeForNewMessageId() first. Current:', streamingMessage.value.sdkMessageId,
        'New:', sdkMessageId
      );
    }
    return streamingMessage.value;
  }

  /**
   * Update tool status in streaming message, messages array, or cache.
   * Caching handles race conditions where status arrives before tool is in UI.
   */
  function updateToolStatus(
    toolUseId: string,
    status: ToolCall['status'],
    result?: string,
    errorMessage?: string
  ): void {
    // Always cache - ensures we have it even if tool isn't in UI yet
    toolStatusCache.value.set(toolUseId, { status, result, errorMessage });

    // Check streaming message first (most likely location)
    if (streamingMessage.value?.toolCalls) {
      const tool = streamingMessage.value.toolCalls.find(t => t.id === toolUseId);
      if (tool) {
        tool.status = status;
        if (result !== undefined) tool.result = result;
        if (errorMessage !== undefined) tool.errorMessage = errorMessage;
        return;
      }
    }

    // Check completed messages
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

  /**
   * Add a tool call to the streaming message.
   */
  function addToolCall(tool: { id: string; name: string; input: Record<string, unknown> }): void {
    const msg = ensureStreamingMessage();
    if (!msg.toolCalls) {
      msg.toolCalls = [];
    }

    // Only add if not already present
    if (!msg.toolCalls.find(t => t.id === tool.id)) {
      // Check cache for any status already received
      const cached = toolStatusCache.value.get(tool.id);
      msg.toolCalls.push({
        id: tool.id,
        name: tool.name,
        input: tool.input,
        status: cached?.status ?? 'pending',
        result: cached?.result,
        errorMessage: cached?.errorMessage,
      });
      if (cached) {
        toolStatusCache.value.delete(tool.id);
      }
    }

    // Tool arrival means thinking phase is over
    msg.isThinkingPhase = false;
  }

  /**
   * Merge tool calls by ID, keeping the one with the most advanced status.
   */
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
      if (!exists || statusPriority[tool.status] >= statusPriority[exists.status]) {
        merged.set(tool.id, tool);
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Extract text content from SDK content blocks.
   */
  function extractTextFromContent(content: ContentBlock[]): string {
    return content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  /**
   * Extract tool calls from SDK content blocks.
   */
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

  /**
   * Extract thinking content from SDK content blocks.
   */
  function extractThinkingContent(content: ContentBlock[]): string | undefined {
    const thinkingBlocks = content.filter(
      (block): block is { type: 'thinking'; thinking: string } => block.type === 'thinking'
    );
    if (thinkingBlocks.length === 0) return undefined;
    return thinkingBlocks.map((block) => block.thinking).join('\n\n');
  }

  /**
   * Add a user message to the messages array.
   */
  function addUserMessage(content: string, isReplay = false): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      isReplay,
    };
    messages.value.push(msg);
    return msg;
  }

  /**
   * Add an error message to the messages array.
   */
  function addErrorMessage(error: string): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      role: 'error',
      content: error,
      timestamp: Date.now(),
    };
    messages.value.push(msg);
    return msg;
  }

  /**
   * Clear all messages and reset state.
   */
  function clearAll(): void {
    messages.value = [];
    streamingMessage.value = null;
    toolStatusCache.value.clear();
  }

  /**
   * Prepend messages to the front (for history loading).
   */
  function prependMessages(olderMessages: ChatMessage[]): void {
    messages.value = [...olderMessages, ...messages.value];
  }

  return {
    // State
    messages,
    streamingMessage,
    toolStatusCache,

    // Core operations
    generateId,
    finalizeStreamingMessage,
    checkAndFinalizeForNewMessageId,
    ensureStreamingMessage,

    // Tool operations
    updateToolStatus,
    addToolCall,
    mergeToolCalls,

    // Content extraction
    extractTextFromContent,
    extractToolCalls,
    extractThinkingContent,

    // Message operations
    addUserMessage,
    addErrorMessage,
    clearAll,
    prependMessages,
  };
}

/** Type for the return value of useStreamingMessage composable */
export type UseStreamingMessageReturn = ReturnType<typeof useStreamingMessage>;
