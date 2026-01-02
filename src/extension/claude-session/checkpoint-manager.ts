import { log } from '../logger';
import {
  persistInterruptMarker,
  persistUserMessage,
  persistPartialAssistant,
  findUserMessageInCurrentTurn,
  findLastMessageInCurrentTurn,
  getLastMessageUuid,
  getMessageParentUuid,
} from '../session';
import type { MessageCallbacks, Query, RewindOption, StreamingContent } from './types';
import { retryWithBackoff } from './utils';

/**
 * CheckpointManager handles rewind, checkpoints, and session identity.
 *
 * Responsibilities:
 * - File checkpoint rewind via SDK
 * - Conversation forking via resumeSessionAt
 * - Track message → user message checkpoints
 * - Accumulate session cost
 * - Handle interrupt persistence
 */
export class CheckpointManager {
  private _resumeSessionId: string | null = null;
  private _pendingResumeSessionAt: string | null = null;
  private messageCheckpoints: Map<string, string> = new Map();
  private _accumulatedCost = 0;
  private _wasInterrupted = false;
  private _currentPrompt: string | null = null;

  constructor(
    private cwd: string,
    private callbacks: MessageCallbacks
  ) {}

  get resumeSessionId(): string | null {
    return this._resumeSessionId;
  }

  setResumeSession(sessionId: string | null): void {
    this._resumeSessionId = sessionId;
  }

  clearResumeSession(): void {
    this._resumeSessionId = null;
  }

  get pendingResumeAt(): string | null {
    return this._pendingResumeSessionAt;
  }

  clearPendingResumeAt(): string | null {
    const value = this._pendingResumeSessionAt;
    this._pendingResumeSessionAt = null;
    return value;
  }

  get wasInterrupted(): boolean {
    return this._wasInterrupted;
  }

  set wasInterrupted(value: boolean) {
    this._wasInterrupted = value;
  }

  get currentPrompt(): string | null {
    return this._currentPrompt;
  }

  set currentPrompt(value: string | null) {
    this._currentPrompt = value;
  }

  /** Track checkpoint mapping assistant message → user message */
  trackCheckpoint(assistantMessageId: string, userMessageId: string): void {
    this.messageCheckpoints.set(assistantMessageId, userMessageId);
  }

  /** Get checkpoint (user message) for an assistant message */
  getCheckpointForMessage(assistantMessageId: string): string | undefined {
    return this.messageCheckpoints.get(assistantMessageId);
  }

  /** Update accumulated cost */
  updateCost(cost: number): void {
    this._accumulatedCost = cost;
  }

  /** Get accumulated cost */
  getAccumulatedCost(): number {
    return this._accumulatedCost;
  }

  /**
   * Rewind to a specific message with various restore options.
   *
   * Options:
   * - 'code-and-conversation': Restore files + fork conversation (both)
   * - 'conversation-only': Fork conversation only (no file restore)
   * - 'code-only': Restore files only (conversation stays linear)
   *
   * Returns whether to clear session (true if rewinding to very beginning).
   */
  async rewindFiles(
    userMessageId: string,
    option: RewindOption,
    sessionId: string | null,
    query: Query | null,
    onResetQuery: (clearSession: boolean) => void
  ): Promise<void> {
    const needsFileRewind = option === 'code-and-conversation' || option === 'code-only';
    const needsConversationFork = option === 'code-and-conversation' || option === 'conversation-only';

    let fileRewindError: string | null = null;

    try {
      // Get parentUuid first - needed for conversation fork decision
      let parentUuid: string | null = null;
      if (sessionId) {
        parentUuid = await getMessageParentUuid(this.cwd, sessionId, userMessageId);
      }

      if (needsFileRewind) {
        if (!query) {
          fileRewindError = 'No active session to rewind files';
        } else {
          try {
            await query.rewindFiles(userMessageId);
          } catch (fileErr) {
            const errorMsg = fileErr instanceof Error ? fileErr.message : String(fileErr);
            log('[CheckpointManager] File rewind failed: %s', errorMsg);
            fileRewindError = errorMsg;
          }
        }
      }

      if (needsConversationFork) {
        if (!sessionId) {
          this.callbacks.onMessage({
            type: 'rewindError',
            message: 'No active session for conversation fork',
          });
          return;
        }

        if (!parentUuid) {
          this._pendingResumeSessionAt = null;
          onResetQuery(true);
        } else {
          this._pendingResumeSessionAt = parentUuid;
          onResetQuery(false);
        }
      }

      this.callbacks.onMessage({
        type: 'rewindComplete',
        rewindToMessageId: userMessageId,
        option,
        ...(fileRewindError && { fileRewindWarning: fileRewindError }),
      });
    } catch (error) {
      log('[CheckpointManager] rewindFiles error: %s', error instanceof Error ? error.message : error);
      this.callbacks.onMessage({
        type: 'rewindError',
        message: error instanceof Error ? error.message : 'Rewind failed',
      });
    }
  }

  /**
   * Handle interrupt persistence after message processing.
   */
  async handleInterruptPersistence(
    sessionId: string,
    lastUserMessageId: string | null,
    streamingContent: StreamingContent,
    currentModel: string | null
  ): Promise<string | null> {
    if (!this._wasInterrupted || !this._currentPrompt) {
      return null;
    }

    try {
      const prompt = this._currentPrompt;
      const sdkUserMessage = await retryWithBackoff(
        () => findUserMessageInCurrentTurn(this.cwd, sessionId, prompt),
        (msg) => msg !== null
      );

      const sdkWroteUserMessage = sdkUserMessage !== null;

      if (sdkWroteUserMessage && sdkUserMessage) {
        const lastMsgUuid = await findLastMessageInCurrentTurn(this.cwd, sessionId);
        let lastUuidForChain = lastMsgUuid ?? sdkUserMessage.uuid;

        if (streamingContent.text && lastUuidForChain) {
          const partialUuid = await persistPartialAssistant({
            workspacePath: this.cwd,
            sessionId,
            parentUuid: lastUuidForChain,
            text: streamingContent.text,
            model: currentModel ?? undefined,
          });
          lastUuidForChain = partialUuid;
        }

        if (lastUuidForChain) {
          return await persistInterruptMarker({
            workspacePath: this.cwd,
            sessionId,
            parentUuid: lastUuidForChain,
          });
        }
      } else {
        let parentUuid = lastUserMessageId;
        if (!parentUuid) {
          parentUuid = await getLastMessageUuid(this.cwd, sessionId);
        }

        const userMessageUuid = await persistUserMessage({
          workspacePath: this.cwd,
          sessionId,
          content: this._currentPrompt,
          parentUuid: parentUuid ?? undefined,
        });

        return await persistInterruptMarker({
          workspacePath: this.cwd,
          sessionId,
          parentUuid: userMessageUuid,
        });
      }
    } catch (err) {
      log('[CheckpointManager] Error persisting interrupt:', err);
    }

    return null;
  }

  /**
   * Read user message UUID after successful message processing.
   * @param excludeUuid - UUID to exclude (the previously known last user message)
   */
  async readUserMessageUuid(sessionId: string, excludeUuid?: string | null): Promise<string | null> {
    if (!this._currentPrompt) {
      return null;
    }

    try {
      const prompt = this._currentPrompt;
      const sdkUserMessage = await retryWithBackoff(
        () => findUserMessageInCurrentTurn(this.cwd, sessionId, prompt),
        (msg) => msg !== null && (!excludeUuid || msg.uuid !== excludeUuid)
      );

      return sdkUserMessage?.uuid ?? null;
    } catch (err) {
      log('[CheckpointManager] Error reading user message UUID:', err);
    }

    return null;
  }

  /**
   * Get last message UUID from session file.
   */
  async getLastMessageUuid(sessionId: string): Promise<string | null> {
    try {
      return await getLastMessageUuid(this.cwd, sessionId);
    } catch (err) {
      log('[CheckpointManager] getLastMessageUuid failed:', err);
      return null;
    }
  }

  /**
   * Read UUID for a flushed (queued) message after its turn completes.
   */
  async readFlushedMessageUuid(
    sessionId: string,
    content: string,
    excludeUuid?: string | null
  ): Promise<string | null> {
    try {
      const sdkUserMessage = await retryWithBackoff(
        () => findUserMessageInCurrentTurn(this.cwd, sessionId, content),
        (msg) => msg !== null && (!excludeUuid || msg.uuid !== excludeUuid)
      );

      return sdkUserMessage?.uuid ?? null;
    } catch (err) {
      log('[CheckpointManager] Error reading flushed message UUID:', err);
      return null;
    }
  }

  /** Reset all checkpoint state */
  reset(): void {
    this._resumeSessionId = null;
    this._pendingResumeSessionAt = null;
    this.messageCheckpoints.clear();
    this._accumulatedCost = 0;
    this._wasInterrupted = false;
    this._currentPrompt = null;
  }
}
