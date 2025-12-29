import { log } from '../logger';
import { getLastMessageUuid } from '../session';
import type { SessionOptions, MessageCallbacks, RewindOption } from './types';
import { ToolManager } from './tool-manager';
import { StreamingManager, type CheckpointTracker } from './streaming-manager';
import { CheckpointManager } from './checkpoint-manager';
import { QueryManager } from './query-manager';
import type { PermissionMode, ModelInfo, SlashCommandInfo, McpServerStatusInfo } from '../../shared/types';

export { SessionOptions } from './types';

/**
 * ClaudeSession coordinates the SDK interaction through focused managers.
 *
 * This is a thin facade that:
 * - Wires managers together via dependency injection
 * - Exposes the public API (unchanged from original)
 * - Delegates all logic to specialized managers
 *
 * Manager responsibilities:
 * - QueryManager: SDK lifecycle, configuration, query methods
 * - StreamingManager: Message processing, content accumulation
 * - ToolManager: Permission handling, tool correlation
 * - CheckpointManager: Rewind, checkpoints, cost tracking
 */
export class ClaudeSession {
  private toolManager: ToolManager;
  private streamingManager: StreamingManager;
  private checkpointManager: CheckpointManager;
  private queryManager: QueryManager;
  private options: SessionOptions;

  constructor(options: SessionOptions) {
    this.options = options;

    const callbacks: MessageCallbacks = {
      onMessage: options.onMessage,
      onSessionIdChange: options.onSessionIdChange,
    };

    const checkpointTracker: CheckpointTracker = {
      trackCheckpoint: (assistantId, userId) => this.checkpointManager.trackCheckpoint(assistantId, userId),
      updateCost: (cost) => this.checkpointManager.updateCost(cost),
    };

    this.toolManager = new ToolManager(options.permissionHandler, callbacks);
    this.checkpointManager = new CheckpointManager(options.cwd, callbacks);
    this.streamingManager = new StreamingManager(callbacks, this.toolManager, checkpointTracker, options.cwd);
    this.queryManager = new QueryManager(options, callbacks, this.toolManager, this.streamingManager);
  }

  get currentSessionId(): string | null {
    return this.streamingManager.sessionId;
  }

  get processing(): boolean {
    return this.streamingManager.isProcessing;
  }

  get canRewindFiles(): boolean {
    return this.queryManager.canRewind;
  }

  get conversationHead(): string | null {
    return this.checkpointManager.pendingResumeAt;
  }

  setResumeSession(sessionId: string | null): void {
    this.checkpointManager.setResumeSession(sessionId);
    this.streamingManager.sessionId = sessionId;
    if (sessionId) {
      this.queryManager.ensureStreamingQuery(sessionId, null).catch(err => {
        log('[ClaudeSession] Failed to initialize resumed session:', err);
      });
    }
  }

  async sendMessage(prompt: string, agentId?: string): Promise<void> {
    if (this.streamingManager.isProcessing) {
      this.options.onMessage({
        type: 'error',
        message: 'A request is already in progress',
      });
      return;
    }

    const sessionToResume = this.checkpointManager.resumeSessionId || this.streamingManager.sessionId;
    const pendingResumeAt = this.checkpointManager.clearPendingResumeAt();

    await this.queryManager.ensureStreamingQuery(sessionToResume ?? undefined, pendingResumeAt);

    if (!this.queryManager.hasActiveQuery) {
      this.options.onMessage({
        type: 'error',
        message: 'Failed to initialize streaming query',
      });
      return;
    }

    if (this.checkpointManager.resumeSessionId) {
      this.checkpointManager.clearResumeSession();
    }

    this.streamingManager.processing = true;
    this.streamingManager.resetTurn();
    this.checkpointManager.currentPrompt = prompt;
    this.checkpointManager.wasInterrupted = false;

    await this.queryManager.sendMessage(prompt);

    const sessionId = this.streamingManager.sessionId;
    if (sessionId && !this.checkpointManager.wasInterrupted) {
      const uuid = await this.checkpointManager.readUserMessageUuid(sessionId);
      if (uuid) {
        this.streamingManager.lastUserMessageId = uuid;
        this.options.onMessage({
          type: 'userMessageIdAssigned',
          sdkMessageId: uuid,
        });
      }
    }

    if (this.checkpointManager.wasInterrupted && sessionId) {
      const interruptUuid = await this.checkpointManager.handleInterruptPersistence(
        sessionId,
        this.streamingManager.lastUserMessageId,
        this.streamingManager.currentStreamingContent,
        this.queryManager.currentModel
      );
      if (interruptUuid) {
        this.streamingManager.lastUserMessageId = interruptUuid;
      }
    } else if (sessionId) {
      const lastUuid = await this.checkpointManager.getLastMessageUuid(sessionId);
      if (lastUuid) {
        this.streamingManager.lastUserMessageId = lastUuid;
      }
    }

    this.checkpointManager.currentPrompt = null;
    if (this.checkpointManager.wasInterrupted) {
      this.options.onMessage({ type: 'sessionCancelled' });
    }
  }

  cancel(): void {
    this.checkpointManager.wasInterrupted = true;
    this.queryManager.abort();
    this.streamingManager.processing = false;
  }

  reset(): void {
    this.cancel();
    this.queryManager.reset();
    this.streamingManager.resetStreaming();
    this.streamingManager.sessionId = null;
    this.checkpointManager.reset();
  }

  async interrupt(): Promise<void> {
    this.checkpointManager.wasInterrupted = true;
    await this.queryManager.interrupt();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.queryManager.setPermissionMode(mode);
  }

  async setModel(model?: string): Promise<void> {
    await this.queryManager.setModel(model);
  }

  async setMaxThinkingTokens(tokens: number | null): Promise<void> {
    await this.queryManager.setMaxThinkingTokens(tokens);
  }

  async getSupportedModels(): Promise<ModelInfo[]> {
    return this.queryManager.getSupportedModels();
  }

  async getSupportedCommands(): Promise<SlashCommandInfo[]> {
    return this.queryManager.getSupportedCommands();
  }

  async getMcpServerStatus(): Promise<McpServerStatusInfo[]> {
    return this.queryManager.getMcpServerStatus();
  }

  async rewindFiles(userMessageId: string, option: RewindOption = 'code-only'): Promise<void> {
    const sessionId = this.streamingManager.sessionId;
    const needsFileRewind = option === 'code-and-conversation' || option === 'code-only';

    // Ensure we have a query for file rewind operations
    if (needsFileRewind && sessionId && !this.queryManager.query) {
      await this.queryManager.ensureStreamingQuery(sessionId, null);
    }

    await this.checkpointManager.rewindFiles(
      userMessageId,
      option,
      sessionId,
      this.queryManager.query,
      (clearSession: boolean) => {
        this.queryManager.closeAndReset();
        if (clearSession) {
          this.streamingManager.sessionId = null;
          this.checkpointManager.setResumeSession(null);
        }
      }
    );
  }

  getCheckpointForMessage(assistantMessageId: string): string | undefined {
    return this.checkpointManager.getCheckpointForMessage(assistantMessageId);
  }

  getAccumulatedCost(): number {
    return this.checkpointManager.getAccumulatedCost();
  }
}
