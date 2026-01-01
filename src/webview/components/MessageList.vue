<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { ChatMessage, CompactMarker as CompactMarkerType, SubagentState } from "@shared/types";
import ToolCallCard from "./ToolCallCard.vue";
import SubagentCard from "./SubagentCard.vue";
import CompactMarker from "./CompactMarker.vue";
import ThinkingIndicator from "./ThinkingIndicator.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import MessageContent from "./MessageContent.vue";
import { Button } from "@/components/ui/button";

const logoUri = ref("");

onMounted(() => {
  logoUri.value = document.getElementById("app")?.dataset.logoUri ?? "";
});

const props = defineProps<{
  messages: ChatMessage[];
  streamingMessageId?: string | null;
  compactMarkers?: CompactMarkerType[];
  checkpointMessages?: Set<string>;
  subagents?: Record<string, SubagentState>;
}>();

const emit = defineEmits<{
  (e: "rewind"): void;
  (e: "interrupt", toolId: string): void;
  (e: "expandSubagent", subagentId: string): void;
  (e: "expandMcpTool", toolId: string): void;
}>();

function isStreamingMessage(message: ChatMessage): boolean {
  return !!props.streamingMessageId && message.id === props.streamingMessageId;
}

function isTaskToolWithSubagent(toolId: string, toolName: string): boolean {
  return toolName === 'Task' && (props.subagents ? toolId in props.subagents : false);
}

function getMarkersBeforeMessage(messageTimestamp: number, messageIndex: number): CompactMarkerType[] {
  if (!props.compactMarkers) return [];
  const prevTimestamp = messageIndex > 0 ? props.messages[messageIndex - 1]?.timestamp : 0;
  return props.compactMarkers.filter((marker) => marker.timestamp > prevTimestamp && marker.timestamp <= messageTimestamp);
}

function getTrailingMarkers(): CompactMarkerType[] {
  if (!props.compactMarkers || props.compactMarkers.length === 0) return [];
  const lastMsgTimestamp = props.messages.length > 0
    ? props.messages[props.messages.length - 1].timestamp
    : 0;
  return props.compactMarkers.filter((marker) => marker.timestamp > lastMsgTimestamp);
}

function hasMarkersToShow(): boolean {
  return (props.compactMarkers?.length ?? 0) > 0;
}

function canRewindTo(message: ChatMessage): boolean {
  return message.role === "user" && !!message.sdkMessageId && (props.checkpointMessages?.has(message.sdkMessageId) ?? false);
}

function isTodoWriteTool(toolName: string): boolean {
  return toolName === 'TodoWrite';
}
</script>

<template>
  <div class="p-4 space-y-4 bg-background" :class="messages.length === 0 && !hasMarkersToShow() ? 'flex flex-col justify-center' : ''">
    <!-- Welcome message - only show when no messages AND no compact markers -->
    <div v-if="messages.length === 0 && !hasMarkersToShow()" class="text-center w-full px-4">
      <img :src="logoUri" alt="Claude Unbound" class="w-16 h-16 mx-auto mb-4" />
      <p class="text-xl mb-2 text-foreground font-medium">Welcome to Claude Unbound</p>
      <p class="text-sm text-muted-foreground">
        Unleash the full power of Claude AI. Ask anything about your code or let me help you build something new.
      </p>
    </div>

    <template v-for="(message, index) in messages" :key="message.id">
      <!-- Compact markers before this message -->
      <CompactMarker v-for="marker in getMarkersBeforeMessage(message.timestamp, index)" :key="marker.id" :marker="marker" />

      <!-- User message -->
      <div v-if="message.role === 'user'" class="group relative animate-message-enter">
        <Button
          v-if="canRewindTo(message) && !message.isInjected"
          variant="ghost"
          size="icon-sm"
          class="absolute -left-6 top-2 opacity-0 group-hover:opacity-100 text-base text-muted-foreground hover:text-foreground hover:bg-transparent"
          title="Undo file changes after this point"
          @click="emit('rewind')"
        >
          ⏪
        </Button>

        <div
          class="rounded-lg px-4 py-3 border-l-2 bg-muted"
          :class="message.isInjected || message.isQueued ? 'border-amber-500/70' : 'border-primary'"
        >
          <div v-if="message.isInjected || message.isQueued" class="flex items-center gap-2 mb-2 text-xs text-amber-400/80">
            <span class="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30">↳ sent mid-stream</span>
            <span v-if="message.isQueued" class="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30">queued</span>
          </div>
          <MarkdownRenderer :content="message.content" class="text-foreground" />
        </div>
      </div>

      <!-- Error message (interrupts, failures) -->
      <div v-else-if="message.role === 'error'" class="pl-4 text-error animate-message-enter">Error: {{ message.content }}</div>

      <!-- Assistant message (including streaming) -->
      <div v-else class="group relative space-y-3" :class="isStreamingMessage(message) ? 'animate-fade-in' : 'animate-message-enter'">
        <ThinkingIndicator
          v-if="message.thinking || message.thinkingContent || message.isPartial || message.thinkingDuration"
          :thinking="message.thinking || message.thinkingContent"
          :is-streaming="message.isThinkingPhase"
          :duration="message.thinkingDuration"
        />

        <!-- Tool calls appear BEFORE text (Claude: think → use tools → respond) -->
        <div v-if="message.toolCalls?.length" class="pl-4 space-y-2">
          <template v-for="tool in message.toolCalls" :key="tool.id">
            <SubagentCard
              v-if="isTaskToolWithSubagent(tool.id, tool.name) && subagents?.[tool.id]"
              :subagent="subagents[tool.id]"
              @expand="emit('expandSubagent', tool.id)"
            />
            <ToolCallCard v-else-if="!isTodoWriteTool(tool.name)" :tool-call="tool" @interrupt="emit('interrupt', $event)" @expand="emit('expandMcpTool', $event)" />
          </template>
        </div>

        <!-- Final text response appears AFTER tools -->
        <div v-if="message.content" class="pl-4">
          <MessageContent
            :content="message.content"
            :is-streaming="isStreamingMessage(message)"
            :is-thinking-phase="message.isThinkingPhase ?? false"
          />
        </div>
      </div>
    </template>

    <!-- Trailing compact markers (after all messages, or when no messages exist) -->
    <CompactMarker
      v-for="marker in getTrailingMarkers()"
      :key="marker.id"
      :marker="marker"
    />
  </div>
</template>
