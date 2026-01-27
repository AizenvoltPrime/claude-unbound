import type { PendingAssistantMessage, StreamingContent } from '../types';

/**
 * Calculate thinking duration when transitioning out of thinking phase.
 * Mutates streamingContent to set isThinking=false and thinkingDuration.
 *
 * @returns The calculated duration in seconds, or null if not applicable
 */
export function calculateThinkingDuration(streamingContent: StreamingContent): number | null {
  if (
    streamingContent.isThinking &&
    streamingContent.thinkingStartTime &&
    !streamingContent.thinkingDuration
  ) {
    streamingContent.thinkingDuration = Math.max(
      1,
      Math.round((Date.now() - streamingContent.thinkingStartTime) / 1000)
    );
    streamingContent.isThinking = false;
    return streamingContent.thinkingDuration;
  }
  return null;
}

/**
 * Commit accumulated streaming text to pending assistant content.
 * Mutates both streamingContent (clears text) and pendingAssistant (appends block).
 */
export function commitStreamingText(
  streamingContent: StreamingContent,
  pendingAssistant: PendingAssistantMessage | null
): void {
  if (!streamingContent.text || !pendingAssistant) return;

  pendingAssistant.content.push({
    type: 'text',
    text: streamingContent.text,
  });
  streamingContent.text = '';
}
