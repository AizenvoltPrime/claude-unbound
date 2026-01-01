import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { ChatMessage, ToolCall, SubagentState, SubagentResult } from '@shared/types';

export interface StreamingSubagentMessage {
  sdkMessageId: string;
  content: string;
  thinking?: string;
  thinkingDuration?: number;
  isThinkingPhase: boolean;
}

export const useSubagentStore = defineStore('subagent', () => {
  const subagents = ref<Record<string, SubagentState>>({});
  const expandedSubagentId = ref<string | null>(null);
  const streamingMessages = ref<Record<string, StreamingSubagentMessage>>({});

  const expandedSubagent = computed((): SubagentState | undefined => {
    if (!expandedSubagentId.value) return undefined;
    return subagents.value[expandedSubagentId.value];
  });

  function registerTaskTool(
    toolId: string,
    input: { description?: string; prompt?: string; subagent_type?: string }
  ): void {
    if (toolId in subagents.value) return;

    const subagentType = (input.subagent_type as string) || 'general-purpose';
    const description = (input.description as string) || subagentType;

    subagents.value = {
      ...subagents.value,
      [toolId]: {
        id: toolId,
        agentType: subagentType,
        description,
        prompt: (input.prompt as string) || '',
        status: 'running',
        startTime: Date.now(),
        messages: [],
        toolCalls: [],
      },
    };
  }

  function startSubagent(_agentId: string, _agentType: string): void {
    // No-op - state is created in registerTaskTool
  }

  function stopSubagent(_agentId: string): void {
    // No-op: SDK fires SubagentStop BEFORE PostToolUse, so sdkAgentId isn't set yet.
    // Normal completion: handled by completeSubagent() via toolCompleted
    // Interrupt: handled by cancelRunningSubagents() via sessionCancelled
  }

  function completeSubagent(taskToolId: string): void {
    const subagent = subagents.value[taskToolId];
    if (subagent && subagent.status === 'running') {
      subagents.value = {
        ...subagents.value,
        [taskToolId]: {
          ...subagent,
          status: 'completed',
          endTime: Date.now(),
        },
      };
    }
  }

  function failSubagent(taskToolId: string): void {
    const subagent = subagents.value[taskToolId];
    if (subagent && subagent.status === 'running') {
      subagents.value = {
        ...subagents.value,
        [taskToolId]: {
          ...subagent,
          status: 'failed',
          endTime: Date.now(),
        },
      };
    }
  }

  function cancelRunningSubagents(): void {
    const entries = Object.entries(subagents.value);
    if (entries.length === 0) return;

    const now = Date.now();
    const updated: Record<string, SubagentState> = {};
    let hasChanges = false;

    for (const [id, subagent] of entries) {
      if (subagent.status === 'running') {
        updated[id] = { ...subagent, status: 'cancelled', endTime: now };
        hasChanges = true;
      } else {
        updated[id] = subagent;
      }
    }

    if (hasChanges) {
      subagents.value = updated;
      streamingMessages.value = {};
    }
  }

  function setSubagentResult(taskToolId: string, result: SubagentResult): void {
    const subagent = subagents.value[taskToolId];
    if (subagent) {
      subagents.value = {
        ...subagents.value,
        [taskToolId]: {
          ...subagent,
          result,
          sdkAgentId: result.sdkAgentId || subagent.sdkAgentId,
          status: subagent.status === 'running' ? 'completed' : subagent.status,
          endTime: subagent.status === 'running' ? Date.now() : subagent.endTime,
        },
      };
    }
  }

  function addMessageToSubagent(parentToolUseId: string, message: ChatMessage): void {
    const subagent = subagents.value[parentToolUseId];
    if (subagent) {
      const { [parentToolUseId]: _, ...restStreaming } = streamingMessages.value;
      streamingMessages.value = restStreaming;

      subagents.value = {
        ...subagents.value,
        [parentToolUseId]: {
          ...subagent,
          messages: [...subagent.messages, message],
        },
      };
    }
  }

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
    if (!(parentToolUseId in subagents.value)) return;

    const existing = streamingMessages.value[parentToolUseId];
    if (!existing || existing.sdkMessageId !== sdkMessageId) {
      streamingMessages.value = {
        ...streamingMessages.value,
        [parentToolUseId]: {
          sdkMessageId,
          content: updates.content ?? '',
          thinking: updates.thinking,
          thinkingDuration: updates.thinkingDuration,
          isThinkingPhase: updates.isThinkingPhase ?? true,
        },
      };
    } else {
      streamingMessages.value = {
        ...streamingMessages.value,
        [parentToolUseId]: {
          ...existing,
          ...(updates.content !== undefined && { content: updates.content }),
          ...(updates.thinking !== undefined && { thinking: updates.thinking }),
          ...(updates.thinkingDuration !== undefined && { thinkingDuration: updates.thinkingDuration }),
          ...(updates.isThinkingPhase !== undefined && { isThinkingPhase: updates.isThinkingPhase }),
        },
      };
    }
  }

  function getSubagentStreaming(parentToolUseId: string): StreamingSubagentMessage | undefined {
    return streamingMessages.value[parentToolUseId];
  }

  function addToolCallToSubagent(parentToolUseId: string, tool: ToolCall): void {
    const subagent = subagents.value[parentToolUseId];
    if (subagent) {
      const existing = subagent.toolCalls.find(t => t.id === tool.id);
      if (!existing) {
        subagents.value = {
          ...subagents.value,
          [parentToolUseId]: {
            ...subagent,
            toolCalls: [...subagent.toolCalls, tool],
          },
        };
      }
    }
  }

  function updateSubagentToolStatus(
    toolUseId: string,
    status: ToolCall['status'],
    result?: string,
    errorMessage?: string
  ): boolean {
    for (const [subagentId, subagent] of Object.entries(subagents.value)) {
      const toolIndex = subagent.toolCalls.findIndex(t => t.id === toolUseId);
      if (toolIndex !== -1) {
        const updatedToolCalls = [...subagent.toolCalls];
        updatedToolCalls[toolIndex] = {
          ...updatedToolCalls[toolIndex],
          status,
          ...(result !== undefined && { result }),
          ...(errorMessage !== undefined && { errorMessage }),
        };
        subagents.value = {
          ...subagents.value,
          [subagentId]: {
            ...subagent,
            toolCalls: updatedToolCalls,
          },
        };
        return true;
      }
    }
    return false;
  }

  function getSubagent(id: string): SubagentState | undefined {
    return subagents.value[id];
  }

  function hasSubagent(id: string): boolean {
    return id in subagents.value;
  }

  function getSubagentDescription(id: string): string | undefined {
    return subagents.value[id]?.description;
  }

  function expandSubagent(id: string): void {
    expandedSubagentId.value = id;
  }

  function collapseSubagent(): void {
    expandedSubagentId.value = null;
  }

  function restoreSubagentFromHistory(
    toolId: string,
    input: Record<string, unknown>,
    resultJson?: string,
    agentToolCalls?: Array<{ id: string; name: string; input: Record<string, unknown>; result?: string }>,
    agentModel?: string,
    sdkAgentId?: string
  ): void {
    if (toolId in subagents.value) return;

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
        console.warn('[useSubagentStore] Failed to parse Task tool result from history');
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
    subagents.value = {
      ...subagents.value,
      [toolId]: {
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
      },
    };
  }

  function $reset() {
    subagents.value = {};
    streamingMessages.value = {};
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
    $reset,
  };
});
