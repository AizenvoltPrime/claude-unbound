import { ref, computed } from 'vue';
import type { ChatMessage, ToolCall, SubagentState, SubagentResult } from '@shared/types';

interface StreamingSubagentMessage {
  sdkMessageId: string;
  content: string;
  thinking?: string;
  thinkingDuration?: number;
  isThinkingPhase: boolean;
}

/**
 * Composable for managing subagent (Task tool) messages and state.
 *
 * Key concepts:
 * - Task tools arrive via `toolStreaming` BEFORE `subagentStart` hook fires
 * - SDK's agent_id (from SubagentStart) is DIFFERENT from Task tool's tool.id
 * - Messages with `parentToolUseId` reference the Task tool's ID directly
 * - SubagentState is created immediately on registerTaskTool (not on subagentStart)
 * - This ensures correct state for parallel agents where subagentStart order differs
 * - Final status is set by toolCompleted/toolFailed, not subagentStop
 */
export function useSubagentMessages() {
  const subagents = ref<Map<string, SubagentState>>(new Map());
  const expandedSubagentId = ref<string | null>(null);
  const streamingMessages = ref<Map<string, StreamingSubagentMessage>>(new Map());

  /**
   * Register a Task tool when toolStreaming arrives (before subagentStart).
   * Creates SubagentState immediately to ensure correct state for parallel agents.
   */
  function registerTaskTool(
    toolId: string,
    input: { description?: string; prompt?: string; subagent_type?: string }
  ): void {
    if (subagents.value.has(toolId)) return;

    const subagentType = (input.subagent_type as string) || 'general-purpose';
    const description = (input.description as string) || subagentType;

    subagents.value.set(toolId, {
      id: toolId,
      agentType: subagentType,
      description,
      prompt: (input.prompt as string) || '',
      status: 'running',
      startTime: Date.now(),
      messages: [],
      toolCalls: [],
    });
  }

  /**
   * Called when subagentStart hook fires.
   * No-op: SubagentState was already created in registerTaskTool.
   * The SDK's agent_id cannot be reliably correlated with task tool IDs
   * for parallel agents, so we don't use it.
   */
  function startSubagent(_agentId: string, _agentType: string): void {
    // No-op - state is created in registerTaskTool
  }

  /**
   * Called when subagentStop hook fires.
   * No-op: Final status is set by completeSubagent/failSubagent which
   * use the reliable toolUseId from toolCompleted/toolFailed events.
   */
  function stopSubagent(_agentId: string): void {
    // No-op - status is set via toolCompleted/toolFailed
  }

  /**
   * Mark a subagent as completed.
   * Called when toolCompleted arrives for a Task tool.
   */
  function completeSubagent(taskToolId: string): void {
    const subagent = subagents.value.get(taskToolId);
    if (subagent && subagent.status === 'running') {
      subagent.status = 'completed';
      subagent.endTime = Date.now();
    }
  }

  /**
   * Mark a subagent as failed.
   * Called when toolFailed arrives for a Task tool.
   */
  function failSubagent(taskToolId: string): void {
    const subagent = subagents.value.get(taskToolId);
    if (subagent && subagent.status === 'running') {
      subagent.status = 'failed';
      subagent.endTime = Date.now();
    }
  }

  /**
   * Mark all running subagents as cancelled.
   * Called when session is interrupted (ESC key or pause button).
   */
  function cancelRunningSubagents(): void {
    if (subagents.value.size === 0) return;

    const now = Date.now();
    for (const subagent of subagents.value.values()) {
      if (subagent.status === 'running') {
        subagent.status = 'cancelled';
        subagent.endTime = now;
      }
    }
    streamingMessages.value.clear();
  }

  /**
   * Set the result of a completed subagent.
   * Called when toolCompleted arrives for a Task tool - parses the result JSON.
   * Also marks the subagent as completed if not already.
   * Stores sdkAgentId on both the result and the subagent for JSONL file access.
   */
  function setSubagentResult(taskToolId: string, result: SubagentResult): void {
    const subagent = subagents.value.get(taskToolId);
    if (subagent) {
      subagent.result = result;
      if (result.sdkAgentId) {
        subagent.sdkAgentId = result.sdkAgentId;
      }
      if (subagent.status === 'running') {
        subagent.status = 'completed';
        subagent.endTime = Date.now();
      }
    }
  }

  /**
   * Add a message to the subagent's message list.
   * Also clears any streaming state for this subagent since we have the final message.
   */
  function addMessageToSubagent(parentToolUseId: string, message: ChatMessage): void {
    const subagent = subagents.value.get(parentToolUseId);
    if (subagent) {
      streamingMessages.value.delete(parentToolUseId);
      subagent.messages.push(message);
    }
  }

  /**
   * Update streaming content for a subagent (from partial messages).
   */
  function updateSubagentStreaming(
    parentToolUseId: string,
    sdkMessageId: string,
    updates: {
      content?: string;
      thinking?: string;
      thinkingDuration?: number;
      isThinkingPhase?: boolean;
    }
  ): void {
    if (!subagents.value.has(parentToolUseId)) return;

    let streaming = streamingMessages.value.get(parentToolUseId);
    if (!streaming || streaming.sdkMessageId !== sdkMessageId) {
      streaming = {
        sdkMessageId,
        content: '',
        isThinkingPhase: true,
      };
      streamingMessages.value.set(parentToolUseId, streaming);
    }

    if (updates.content !== undefined) streaming.content = updates.content;
    if (updates.thinking !== undefined) streaming.thinking = updates.thinking;
    if (updates.thinkingDuration !== undefined) streaming.thinkingDuration = updates.thinkingDuration;
    if (updates.isThinkingPhase !== undefined) streaming.isThinkingPhase = updates.isThinkingPhase;
  }

  /**
   * Get streaming message state for a subagent.
   */
  function getSubagentStreaming(parentToolUseId: string): StreamingSubagentMessage | undefined {
    return streamingMessages.value.get(parentToolUseId);
  }

  /**
   * Add a tool call to the subagent's tool list.
   */
  function addToolCallToSubagent(parentToolUseId: string, tool: ToolCall): void {
    const subagent = subagents.value.get(parentToolUseId);
    if (subagent) {
      const existing = subagent.toolCalls.find(t => t.id === tool.id);
      if (!existing) {
        subagent.toolCalls.push(tool);
      }
    }
  }

  /**
   * Update a tool's status within a subagent.
   * Returns true if the tool was found and updated.
   */
  function updateSubagentToolStatus(
    toolUseId: string,
    status: ToolCall['status'],
    result?: string,
    errorMessage?: string
  ): boolean {
    for (const subagent of subagents.value.values()) {
      const tool = subagent.toolCalls.find(t => t.id === toolUseId);
      if (tool) {
        tool.status = status;
        if (result !== undefined) tool.result = result;
        if (errorMessage !== undefined) tool.errorMessage = errorMessage;
        return true;
      }
    }
    return false;
  }

  /**
   * Get a subagent by its ID.
   */
  function getSubagent(id: string): SubagentState | undefined {
    return subagents.value.get(id);
  }

  /**
   * Check if a subagent exists for the given ID.
   */
  function hasSubagent(id: string): boolean {
    return subagents.value.has(id);
  }

  /**
   * Get the description of a subagent by its task tool ID.
   */
  function getSubagentDescription(id: string): string | undefined {
    return subagents.value.get(id)?.description;
  }

  const expandedSubagent = computed((): SubagentState | undefined => {
    if (!expandedSubagentId.value) return undefined;
    return subagents.value.get(expandedSubagentId.value);
  });

  function expandSubagent(id: string): void {
    expandedSubagentId.value = id;
  }

  function collapseSubagent(): void {
    expandedSubagentId.value = null;
  }

  /**
   * Restore a subagent from session history (completed Task tools).
   * Creates a completed SubagentState from the historical data.
   */
  function restoreSubagentFromHistory(
    toolId: string,
    input: Record<string, unknown>,
    resultJson?: string,
    agentToolCalls?: Array<{ id: string; name: string; input: Record<string, unknown>; result?: string }>,
    agentModel?: string,
    sdkAgentId?: string
  ): void {
    if (subagents.value.has(toolId)) return;

    const description = (input.description as string) || '';
    const prompt = (input.prompt as string) || '';
    const subagentType = (input.subagent_type as string) || 'general-purpose';

    let result: SubagentResult | undefined;
    let durationMs: number | undefined;

    if (resultJson) {
      try {
        const parsed = JSON.parse(resultJson);
        const contentItems = parsed.content as Array<{ type: string; text?: string }> | undefined;
        const contentText = contentItems
          ?.filter(item => item.type === 'text' && item.text)
          .map(item => item.text)
          .join('\n') || '';
        result = {
          content: contentText,
          totalDurationMs: parsed.totalDurationMs,
          totalTokens: parsed.totalTokens,
          totalToolUseCount: parsed.totalToolUseCount,
          sdkAgentId: sdkAgentId || parsed.agentId,
        };
        durationMs = parsed.totalDurationMs;
      } catch {
        console.warn('[useSubagentMessages] Failed to parse Task tool result from history');
      }
    }

    const toolCalls: ToolCall[] = (agentToolCalls || []).map(t => ({
      id: t.id,
      name: t.name,
      input: t.input,
      status: 'completed' as const,
      result: t.result,
    }));

    const now = Date.now();
    subagents.value.set(toolId, {
      id: toolId,
      agentType: subagentType,
      description: description || subagentType,
      prompt,
      status: 'completed',
      startTime: durationMs ? now - durationMs : now,
      endTime: now,
      messages: [],
      toolCalls,
      result,
      model: agentModel,
      sdkAgentId: sdkAgentId || result?.sdkAgentId,
    });
  }

  /**
   * Clear all subagent state (on session clear).
   */
  function clearSubagents(): void {
    subagents.value.clear();
    streamingMessages.value.clear();
    expandedSubagentId.value = null;
  }

  return {
    subagents,
    expandedSubagentId,
    expandedSubagent,
    streamingMessages,

    registerTaskTool,
    startSubagent,
    stopSubagent,
    completeSubagent,
    failSubagent,
    cancelRunningSubagents,
    setSubagentResult,
    addMessageToSubagent,
    updateSubagentStreaming,
    getSubagentStreaming,
    addToolCallToSubagent,
    updateSubagentToolStatus,
    getSubagent,
    hasSubagent,
    getSubagentDescription,
    expandSubagent,
    collapseSubagent,
    restoreSubagentFromHistory,
    clearSubagents,
  };
}

export type UseSubagentMessagesReturn = ReturnType<typeof useSubagentMessages>;
