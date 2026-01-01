import { log } from '../logger';
import type { PermissionHandler } from '../PermissionHandler';
import type { MessageCallbacks, StreamedToolInfo, ToolPermissionResult } from './types';
import { serializeToolResult } from './utils';

/**
 * ToolManager handles tool permission checking and correlation.
 *
 * Responsibilities:
 * - Track streamed tools for correlation with canUseTool callback
 * - Maintain FIFO queue for tool correlation (SDK doesn't pass tool_use_id in canUseTool)
 * - Handle tool abandonment when Claude changes course mid-stream
 * - Mark tool usage for turn-level tracking
 */
export class ToolManager {
  private streamedToolIds: Map<string, StreamedToolInfo> = new Map();
  private pendingToolQueue: Map<string, Array<{ toolUseId: string; parentToolUseId: string | null }>> = new Map();
  private toolsUsedThisTurn = false;

  constructor(
    private permissionHandler: PermissionHandler,
    private callbacks: MessageCallbacks
  ) {}

  /** Handle canUseTool callback from SDK */
  async handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    context: { signal: AbortSignal },
    flushCallback: () => void
  ): Promise<ToolPermissionResult> {
    // Get the tool ID first
    const toolQueue = this.pendingToolQueue.get(toolName) ?? [];
    const queuedInfo = toolQueue.shift();
    if (queuedInfo) {
      this.pendingToolQueue.set(toolName, toolQueue);
    } else {
      log('[ToolManager] Warning: canUseTool called but no queued info for tool %s', toolName);
    }
    const toolUseId = queuedInfo?.toolUseId ?? null;
    const parentToolUseId = queuedInfo?.parentToolUseId ?? null;

    // Mark as approved BEFORE flush to prevent sendAbandonedTools from
    // abandoning this tool during flushPendingAssistant
    if (toolUseId) {
      const info = this.streamedToolIds.get(toolUseId);
      if (info) {
        info.approved = true;
      }
    }

    // Now safe to flush - the tool won't be abandoned
    flushCallback();

    const extendedContext = { ...context, toolUseID: toolUseId, parentToolUseId };
    const result = await this.permissionHandler.canUseTool(toolName, input, extendedContext);

    if (result.behavior === 'allow') {
      return {
        behavior: 'allow' as const,
        updatedInput: (result.updatedInput ?? input) as Record<string, unknown>,
      };
    }

    // Tool was denied - delete from tracking and notify
    if (toolUseId) {
      this.streamedToolIds.delete(toolUseId);
      log('[ToolManager] Tool denied, sending toolFailed:', toolName, toolUseId);
      this.callbacks.onMessage({
        type: 'toolFailed',
        toolUseId,
        toolName,
        error: result.message ?? 'Permission denied',
        isInterrupt: false,
        parentToolUseId,
      });
    }
    return {
      behavior: 'deny' as const,
      message: result.message ?? 'Permission denied',
    };
  }

  /** Register a streamed tool for tracking */
  registerStreamedTool(id: string, info: StreamedToolInfo): void {
    this.streamedToolIds.set(id, info);
  }

  /** Queue tool info for correlation with canUseTool */
  queueToolInfo(toolName: string, info: { toolUseId: string; parentToolUseId: string | null }): void {
    const queue = this.pendingToolQueue.get(toolName) ?? [];
    queue.push(info);
    this.pendingToolQueue.set(toolName, queue);
  }

  /** Get and remove streamed tool info by ID */
  getAndRemoveStreamedTool(toolUseId: string): StreamedToolInfo | undefined {
    const info = this.streamedToolIds.get(toolUseId);
    if (info) {
      this.streamedToolIds.delete(toolUseId);
    }
    return info;
  }

  /** Send abandoned tools for a specific message ID (only non-approved tools) */
  sendAbandonedTools(messageId: string): void {
    for (const [toolUseId, info] of this.streamedToolIds.entries()) {
      // Only abandon tools that were never approved (Claude changed course)
      if (info.messageId === messageId && !info.approved) {
        this.callbacks.onMessage({
          type: 'toolAbandoned',
          toolUseId,
          toolName: info.toolName,
          parentToolUseId: info.parentToolUseId,
        });
        this.streamedToolIds.delete(toolUseId);
      }
    }
  }

  /** Send abandoned for ALL remaining streamed tools (used on abort) */
  sendAllAbandonedTools(): void {
    for (const [toolUseId, info] of this.streamedToolIds.entries()) {
      this.callbacks.onMessage({
        type: 'toolAbandoned',
        toolUseId,
        toolName: info.toolName,
        parentToolUseId: info.parentToolUseId,
      });
    }
    this.streamedToolIds.clear();
  }

  /** Handle PreToolUse hook - mark tool as used and notify UI */
  handlePreToolUse(toolName: string | undefined, toolUseId: string | undefined, input: unknown): void {
    if (toolName) {
      this.toolsUsedThisTurn = true;
    }
    if (toolName && toolUseId) {
      const toolInfo = this.streamedToolIds.get(toolUseId);
      if (toolInfo) {
        toolInfo.approved = true;
      }
      const parentToolUseId = toolInfo?.parentToolUseId ?? null;
      this.callbacks.onMessage({
        type: 'toolPending',
        toolUseId,
        toolName,
        input,
        parentToolUseId,
      });
    }
  }

  /** Handle PostToolUse hook - notify UI of tool completion */
  handlePostToolUse(toolName: string | undefined, toolUseId: string | undefined, response: unknown): void {
    if (toolName && toolUseId) {
      const toolInfo = this.streamedToolIds.get(toolUseId);
      const parentToolUseId = toolInfo?.parentToolUseId ?? null;
      this.streamedToolIds.delete(toolUseId);
      this.callbacks.onMessage({
        type: 'toolCompleted',
        toolUseId,
        toolName,
        result: serializeToolResult(response),
        parentToolUseId,
      });
    }
  }

  /** Handle PostToolUseFailure hook - notify UI of tool failure */
  handlePostToolUseFailure(
    toolName: string | undefined,
    toolUseId: string | undefined,
    error: string | undefined,
    isInterrupt: boolean | undefined
  ): void {
    if (toolName && toolUseId) {
      const toolInfo = this.streamedToolIds.get(toolUseId);
      const parentToolUseId = toolInfo?.parentToolUseId ?? null;
      this.streamedToolIds.delete(toolUseId);
      this.callbacks.onMessage({
        type: 'toolFailed',
        toolUseId,
        toolName,
        error: error || 'Unknown error',
        isInterrupt,
        parentToolUseId,
      });
    }
  }

  /** Mark that tools were used this turn */
  markToolUsed(): void {
    this.toolsUsedThisTurn = true;
  }

  /** Check if tools were used this turn */
  get hadToolsThisTurn(): boolean {
    return this.toolsUsedThisTurn;
  }

  /** Reset turn-level state */
  resetTurn(): void {
    this.toolsUsedThisTurn = false;
    this.streamedToolIds.clear();
    this.pendingToolQueue.clear();
  }
}
