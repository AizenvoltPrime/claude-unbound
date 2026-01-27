import type { HandlerRegistry } from "../types";

export function createSubagentHandlers(): Partial<HandlerRegistry> {
  return {
    subagentStart: (msg, ctx) => {
      ctx.stores.subagentStore.startSubagent(msg.agentId, msg.agentType, msg.toolUseId);
    },

    subagentStop: (msg, ctx) => {
      ctx.stores.subagentStore.stopSubagent(msg.agentId);
    },

    subagentModelUpdate: (msg, ctx) => {
      ctx.stores.subagentStore.updateSubagentModel(msg.taskToolId, msg.model);
    },

    subagentMessagesUpdate: (msg, ctx) => {
      ctx.stores.subagentStore.replaceSubagentMessages(msg.taskToolId, msg.messages);
    },
  };
}
