import type { QueuedMessage, UserContentBlock } from '../../shared/types';

/**
 * Factory for creating queued message objects.
 *
 * Messages are injected directly into the SDK input stream via queueInput().
 * This factory only handles message ID/timestamp generation.
 */
export function createQueuedMessage(content: string | UserContentBlock[]): QueuedMessage {
  return {
    id: `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    content,
    timestamp: Date.now(),
  };
}
