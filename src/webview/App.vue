<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import MessageList from './components/MessageList.vue';
import ChatInput from './components/ChatInput.vue';
import { useVSCode } from './composables/useVSCode';
import type { ChatMessage, ToolCall, ContentBlock } from '@shared/types';

const { postMessage, onMessage } = useVSCode();

const messages = ref<ChatMessage[]>([]);
const isProcessing = ref(false);
const currentSessionId = ref<string | null>(null);

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function handleSend(content: string) {
  postMessage({ type: 'sendMessage', content });
}

function handleCancel() {
  postMessage({ type: 'cancelSession' });
}

function extractTextFromContent(content: ContentBlock[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function extractToolCalls(content: ContentBlock[]): ToolCall[] {
  return content
    .filter((block): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
      block.type === 'tool_use'
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input,
      status: 'pending' as const,
    }));
}

onMounted(() => {
  onMessage((message) => {
    switch (message.type) {
      case 'userMessage':
        messages.value.push({
          id: generateId(),
          role: 'user',
          content: message.content,
          timestamp: Date.now(),
        });
        break;

      case 'assistant':
        const assistantMsg = message.data;
        const textContent = extractTextFromContent(assistantMsg.message.content);
        const toolCalls = extractToolCalls(assistantMsg.message.content);

        messages.value.push({
          id: assistantMsg.message.id,
          role: 'assistant',
          content: textContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp: Date.now(),
        });
        currentSessionId.value = assistantMsg.session_id;
        break;

      case 'partial':
        // Update the last assistant message if it's partial
        const lastMsg = messages.value[messages.value.length - 1];
        if (lastMsg?.role === 'assistant') {
          lastMsg.isPartial = true;
        }
        break;

      case 'done':
        const resultData = message.data;
        // Mark last message as complete
        const finalMsg = messages.value[messages.value.length - 1];
        if (finalMsg?.role === 'assistant') {
          finalMsg.isPartial = false;
        }
        break;

      case 'processing':
        isProcessing.value = message.isProcessing;
        break;

      case 'error':
        messages.value.push({
          id: generateId(),
          role: 'assistant',
          content: `**Error:** ${message.message}`,
          timestamp: Date.now(),
        });
        break;

      case 'sessionStarted':
        currentSessionId.value = message.sessionId;
        break;
    }

    // Scroll to bottom on new messages
    nextTick(() => {
      const container = document.querySelector('.message-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  });

  // Notify extension that webview is ready
  postMessage({ type: 'ready' });
});
</script>

<template>
  <div class="flex flex-col h-full">
    <MessageList :messages="messages" class="flex-1 overflow-y-auto message-container" />
    <ChatInput
      :is-processing="isProcessing"
      @send="handleSend"
      @cancel="handleCancel"
    />
  </div>
</template>
