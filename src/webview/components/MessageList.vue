<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import type { ChatMessage, CompactMarker as CompactMarkerType } from '@shared/types';
import ToolCallCard from './ToolCallCard.vue';
import CompactMarker from './CompactMarker.vue';
import ThinkingIndicator from './ThinkingIndicator.vue';
import { Button } from '@/components/ui/button';

const logoUri = ref('');

onMounted(() => {
  logoUri.value = document.getElementById('app')?.dataset.logoUri ?? '';
});

const props = defineProps<{
  messages: ChatMessage[];
  streamingMessage?: ChatMessage | null; // Separate streaming message (isolated from messages array)
  compactMarkers?: CompactMarkerType[];
  checkpointMessages?: Set<string>; // Message IDs that have file checkpoints
}>();

const emit = defineEmits<{
  (e: 'rewind', messageId: string): void;
  (e: 'interrupt', toolId: string): void;
}>();

// Find compact markers that should appear before a message
function getMarkersBeforeMessage(messageTimestamp: number, messageIndex: number): CompactMarkerType[] {
  if (!props.compactMarkers) return [];

  const prevTimestamp = messageIndex > 0 ? props.messages[messageIndex - 1].timestamp : 0;

  return props.compactMarkers.filter(
    marker => marker.timestamp > prevTimestamp && marker.timestamp <= messageTimestamp
  );
}

function canRewindTo(message: ChatMessage): boolean {
  return message.role === 'user' && (props.checkpointMessages?.has(message.id) ?? false);
}

// Configure marked with highlight.js
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Custom renderer for code blocks with syntax highlighting
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language }).value;
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
};

renderer.codespan = ({ text }: { text: string }) => {
  return `<code class="inline-code">${text}</code>`;
};

// Open links in new tab
renderer.link = ({ href, title, text }: { href: string; title?: string | null; text: string }) => {
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.use({ renderer });

function formatMarkdown(text: string): string {
  try {
    const html = marked.parse(text) as string;
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'rel'],
    });
  } catch {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }
}
</script>

<template>
  <div class="p-4 space-y-4 bg-unbound-bg" :class="messages.length === 0 && !streamingMessage ? 'flex flex-col justify-center' : ''">
    <!-- Welcome message -->
    <div v-if="messages.length === 0 && !streamingMessage" class="text-center w-full px-4">
      <img :src="logoUri" alt="Claude Unbound" class="w-16 h-16 mx-auto mb-4" />
      <p class="text-xl mb-2 text-unbound-glow font-medium">Welcome to Claude Unbound</p>
      <p class="text-sm text-unbound-muted">Unleash the full power of Claude AI. Ask anything about your code or let me help you build something new.</p>
    </div>

    <template v-for="(message, index) in messages" :key="message.id">
      <!-- Compact markers before this message -->
      <CompactMarker
        v-for="marker in getMarkersBeforeMessage(message.timestamp, index)"
        :key="marker.id"
        :marker="marker"
      />

      <!-- User message -->
      <div
        v-if="message.role === 'user'"
        class="group relative animate-message-enter"
      >
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

        <div
          class="rounded-lg px-4 py-3 border-l-2 border-unbound-cyan-500 bg-unbound-bg-card"
        >
          <div class="text-unbound-text" v-html="formatMarkdown(message.content)" />
        </div>
      </div>

      <!-- Error message (interrupts, failures) -->
      <div
        v-else-if="message.role === 'error'"
        class="pl-4 text-red-400 animate-message-enter"
      >
        Error: {{ message.content }}
      </div>

      <!-- Assistant message -->
      <div
        v-else
        class="group relative space-y-3 animate-message-enter"
      >
        <ThinkingIndicator
          v-if="message.thinking || message.isPartial"
          :thinking="message.thinking"
          :is-streaming="message.isThinkingPhase"
        />

        <!-- Tool calls appear BEFORE text (Claude: think → use tools → respond) -->
        <div v-if="message.toolCalls?.length" class="pl-4 space-y-2">
          <ToolCallCard
            v-for="tool in message.toolCalls"
            :key="tool.id"
            :tool-call="tool"
            @interrupt="emit('interrupt', $event)"
          />
        </div>

        <!-- Final text response appears AFTER tools -->
        <div
          v-if="message.content"
          class="prose prose-sm max-w-none prose-unbound pl-4"
          :class="message.isPartial && 'opacity-80'"
          v-html="formatMarkdown(message.content)"
        />
      </div>
    </template>

    <!-- Streaming message (isolated from messages array to prevent flashing) -->
    <div
      v-if="streamingMessage"
      class="group relative space-y-3 animate-fade-in"
    >
      <ThinkingIndicator
        v-if="streamingMessage.thinking || streamingMessage.isPartial"
        :thinking="streamingMessage.thinking"
        :is-streaming="streamingMessage.isThinkingPhase"
      />

      <!-- Tool calls appear BEFORE text (Claude: think → use tools → respond) -->
      <div v-if="streamingMessage.toolCalls?.length" class="pl-4 space-y-2">
        <ToolCallCard
          v-for="tool in streamingMessage.toolCalls"
          :key="tool.id"
          :tool-call="tool"
          @interrupt="emit('interrupt', $event)"
        />
      </div>

      <!-- Final text response appears AFTER tools -->
      <div
        v-if="streamingMessage.content"
        class="prose prose-sm max-w-none prose-unbound pl-4"
        :class="streamingMessage.isPartial && 'opacity-80'"
        v-html="formatMarkdown(streamingMessage.content)"
      />
    </div>
  </div>
</template>

<style scoped>
/* Prose styles with cyan/blue theme */
.prose-unbound {
  color: #e0f7fa;
}

.prose-unbound :deep(pre) {
  margin: 8px 0;
  padding: 12px;
  border-radius: 6px;
  background-color: #0a1929;
  border: 1px solid rgba(79, 195, 247, 0.2);
  overflow-x: auto;
}

.prose-unbound :deep(code) {
  font-size: 0.85em;
  font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
}

.prose-unbound :deep(.inline-code) {
  background-color: rgba(79, 195, 247, 0.15);
  color: #4fc3f7;
  padding: 2px 6px;
  border-radius: 4px;
}

.prose-unbound :deep(a) {
  color: #4fc3f7;
  text-decoration: none;
}

.prose-unbound :deep(a:hover) {
  text-decoration: underline;
  color: #81d4fa;
}

.prose-unbound :deep(p) {
  margin: 8px 0;
}

.prose-unbound :deep(ul), .prose-unbound :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.prose-unbound :deep(li) {
  margin: 4px 0;
}

.prose-unbound :deep(blockquote) {
  border-left: 3px solid #00bcd4;
  margin: 8px 0;
  padding-left: 12px;
  color: #81d4fa;
  background: rgba(0, 188, 212, 0.1);
  padding: 8px 12px;
  border-radius: 0 4px 4px 0;
}

.prose-unbound :deep(h1), .prose-unbound :deep(h2), .prose-unbound :deep(h3), .prose-unbound :deep(h4) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
  color: #4fc3f7;
}

.prose-unbound :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}

.prose-unbound :deep(th), .prose-unbound :deep(td) {
  border: 1px solid rgba(79, 195, 247, 0.3);
  padding: 6px 12px;
  text-align: left;
}

.prose-unbound :deep(th) {
  background-color: rgba(0, 188, 212, 0.15);
  color: #4fc3f7;
}

.prose-unbound :deep(strong) {
  color: #81d4fa;
  font-weight: 600;
}

.prose-unbound :deep(em) {
  color: #b2ebf2;
}

/* Highlight.js theme - cyan/blue variant */
.prose-unbound :deep(.hljs) {
  color: #e0f7fa;
}

.prose-unbound :deep(.hljs-keyword),
.prose-unbound :deep(.hljs-selector-tag),
.prose-unbound :deep(.hljs-built_in),
.prose-unbound :deep(.hljs-name),
.prose-unbound :deep(.hljs-tag) {
  color: #4fc3f7;
}

.prose-unbound :deep(.hljs-string),
.prose-unbound :deep(.hljs-title),
.prose-unbound :deep(.hljs-section),
.prose-unbound :deep(.hljs-attribute),
.prose-unbound :deep(.hljs-literal),
.prose-unbound :deep(.hljs-template-tag),
.prose-unbound :deep(.hljs-template-variable),
.prose-unbound :deep(.hljs-type),
.prose-unbound :deep(.hljs-addition) {
  color: #80deea;
}

.prose-unbound :deep(.hljs-comment),
.prose-unbound :deep(.hljs-quote),
.prose-unbound :deep(.hljs-deletion),
.prose-unbound :deep(.hljs-meta) {
  color: #546e7a;
}

.prose-unbound :deep(.hljs-number),
.prose-unbound :deep(.hljs-regexp),
.prose-unbound :deep(.hljs-selector-id),
.prose-unbound :deep(.hljs-selector-class) {
  color: #b2ebf2;
}

.prose-unbound :deep(.hljs-attr),
.prose-unbound :deep(.hljs-variable),
.prose-unbound :deep(.hljs-template-variable),
.prose-unbound :deep(.hljs-link),
.prose-unbound :deep(.hljs-selector-attr),
.prose-unbound :deep(.hljs-selector-pseudo) {
  color: #81d4fa;
}

.prose-unbound :deep(.hljs-function) {
  color: #26c6da;
}

.prose-unbound :deep(.hljs-symbol),
.prose-unbound :deep(.hljs-bullet) {
  color: #00bcd4;
}

.prose-unbound :deep(.hljs-emphasis) {
  font-style: italic;
}

.prose-unbound :deep(.hljs-strong) {
  font-weight: bold;
}
</style>
