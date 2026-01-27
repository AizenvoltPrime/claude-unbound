import type { HandlerRegistry } from "../types";

export function createQueueHandlers(): Partial<HandlerRegistry> {
  return {
    messageQueued: (msg, ctx) => {
      ctx.stores.streamingStore.addQueuedMessage(msg.message);
    },

    queueProcessed: (msg, ctx) => {
      ctx.stores.streamingStore.markQueueProcessed(msg.messageId);
    },

    queueBatchProcessed: (msg, ctx) => {
      ctx.stores.streamingStore.combineQueuedMessages(msg.messageIds, msg.combinedContent, msg.contentBlocks);
    },

    queueCancelled: (msg, ctx) => {
      ctx.stores.streamingStore.removeQueuedMessage(msg.messageId);
    },

    flushedMessagesAssigned: (msg, ctx) => {
      ctx.stores.streamingStore.assignSdkIdToFlushedMessage(msg.queueMessageIds, msg.sdkMessageId);
    },
  };
}
