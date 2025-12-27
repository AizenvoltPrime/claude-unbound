<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { ChatMessage, CompactMarker as CompactMarkerType, SubagentState } from "@shared/types";
import ToolCallCard from "./ToolCallCard.vue";
import SubagentCard from "./SubagentCard.vue";
import CompactMarker from "./CompactMarker.vue";
import ThinkingIndicator from "./ThinkingIndicator.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import { Button } from "@/components/ui/button";

const logoUri = ref("");

onMounted(() => {
  logoUri.value = document.getElementById("app")?.dataset.logoUri ?? "";
});

const props = defineProps<{
  messages: ChatMessage[];
  streamingMessage?: ChatMessage | null;
  compactMarkers?: CompactMarkerType[];
  checkpointMessages?: Set<string>;
  subagents?: Map<string, SubagentState>;
}>();

const emit = defineEmits<{
  (e: "rewind", messageId: string): void;
  (e: "interrupt", toolId: string): void;
  (e: "expandSubagent", subagentId: string): void;
}>();

function isTaskToolWithSubagent(toolId: string, toolName: string): boolean {
  return toolName === 'Task' && (props.subagents?.has(toolId) ?? false);
}

function getMarkersBeforeMessage(messageTimestamp: number, messageIndex: number): CompactMarkerType[] {
  if (!props.compactMarkers) return [];
  const prevTimestamp = messageIndex > 0 ? props.messages[messageIndex - 1].timestamp : 0;
  return props.compactMarkers.filter((marker) => marker.timestamp > prevTimestamp && marker.timestamp <= messageTimestamp);
}

function canRewindTo(message: ChatMessage): boolean {
  return message.role === "user" && (props.checkpointMessages?.has(message.id) ?? false);
}
</script>

<template>
  <div class="p-4 space-y-4 bg-unbound-bg" :class="messages.length === 0 && !streamingMessage ? 'flex flex-col justify-center' : ''">
    <!-- Welcome message -->
    <div v-if="messages.length === 0 && !streamingMessage" class="text-center w-full px-4">
      <img :src="logoUri" alt="Claude Unbound" class="w-16 h-16 mx-auto mb-4" />
      <p class="text-xl mb-2 text-unbound-glow font-medium">Welcome to Claude Unbound</p>
      <p class="text-sm text-unbound-muted">
        Unleash the full power of Claude AI. Ask anything about your code or let me help you build something new.
      </p>
    </div>

    <template v-for="(message, index) in messages" :key="message.id">
      <!-- Compact markers before this message -->
      <CompactMarker v-for="marker in getMarkersBeforeMessage(message.timestamp, index)" :key="marker.id" :marker="marker" />

      <!-- User message -->
      <div v-if="message.role === 'user'" class="group relative animate-message-enter">
        <!-- Rewind button -->
        <Button
          v-if="canRewindTo(message)"
          variant="ghost"
          size="icon-sm"
          class="absolute -left-6 top-2 opacity-0 group-hover:opacity-100 text-base text-unbound-cyan-400 hover:text-unbound-glow hover:bg-transparent"
          title="Undo file changes after this point"
          @click="emit('rewind', message.id)"
        >
          ⏪
        </Button>

        <div class="rounded-lg px-4 py-3 border-l-2 border-unbound-cyan-500 bg-unbound-bg-card">
          <MarkdownRenderer :content="message.content" class="text-unbound-text" />
        </div>
      </div>

      <!-- Error message (interrupts, failures) -->
      <div v-else-if="message.role === 'error'" class="pl-4 text-red-400 animate-message-enter">Error: {{ message.content }}</div>

      <!-- Assistant message -->
      <div v-else class="group relative space-y-3 animate-message-enter">
        <ThinkingIndicator
          v-if="message.thinking || message.isPartial || message.thinkingDuration"
          :thinking="message.thinking"
          :is-streaming="message.isThinkingPhase"
          :duration="message.thinkingDuration"
        />

        <!-- Tool calls appear BEFORE text (Claude: think → use tools → respond) -->
        <div v-if="message.toolCalls?.length" class="pl-4 space-y-2">
          <template v-for="tool in message.toolCalls" :key="tool.id">
            <SubagentCard
              v-if="isTaskToolWithSubagent(tool.id, tool.name) && subagents?.get(tool.id)"
              :subagent="subagents.get(tool.id)!"
              @expand="emit('expandSubagent', tool.id)"
            />
            <ToolCallCard v-else :tool-call="tool" @interrupt="emit('interrupt', $event)" />
          </template>
        </div>

        <!-- Final text response appears AFTER tools -->
        <div v-if="message.content" class="pl-4">
          <MarkdownRenderer :content="message.content" :class="message.isPartial && 'opacity-80'" />
        </div>
      </div>
    </template>

    <!-- Streaming message (isolated from messages array to prevent flashing) -->
    <div v-if="streamingMessage" class="group relative space-y-3 animate-fade-in">
      <ThinkingIndicator
        v-if="streamingMessage.thinking || streamingMessage.isPartial"
        :thinking="streamingMessage.thinking"
        :is-streaming="streamingMessage.isThinkingPhase"
        :duration="streamingMessage.thinkingDuration"
      />

      <!-- Tool calls appear BEFORE text (Claude: think → use tools → respond) -->
      <div v-if="streamingMessage.toolCalls?.length" class="pl-4 space-y-2">
        <template v-for="tool in streamingMessage.toolCalls" :key="tool.id">
          <SubagentCard
            v-if="isTaskToolWithSubagent(tool.id, tool.name) && subagents?.get(tool.id)"
            :subagent="subagents.get(tool.id)!"
            @expand="emit('expandSubagent', tool.id)"
          />
          <ToolCallCard v-else :tool-call="tool" @interrupt="emit('interrupt', $event)" />
        </template>
      </div>

      <!-- Final text response appears AFTER tools -->
      <div v-if="streamingMessage.content" class="pl-4">
        <MarkdownRenderer :content="streamingMessage.content" :class="streamingMessage.isPartial && 'opacity-80'" />
      </div>
    </div>
  </div>
</template>
