<script setup lang="ts">
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import type { ChatMessage } from '@shared/types';
import ToolCallCard from './ToolCallCard.vue';

const props = defineProps<{
  messages: ChatMessage[];
}>();

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
    // Sanitize HTML to prevent XSS attacks
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'rel'], // Allow target="_blank" on links
    });
  } catch {
    // Fallback to escaped text if parsing fails
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }
}
</script>

<template>
  <div class="p-4 space-y-4">
    <div v-if="messages.length === 0" class="text-center text-gray-500 py-8">
      <p class="text-lg mb-2">⚡ Welcome to Claude Unbound</p>
      <p class="text-sm">Unleash the full power of Claude AI. Ask anything about your code or let me help you build something new.</p>
    </div>

    <div
      v-for="message in messages"
      :key="message.id"
      :class="[
        'rounded-lg p-3',
        message.role === 'user'
          ? 'bg-vscode-button-bg text-vscode-button-fg ml-8'
          : 'bg-vscode-input-bg mr-8',
      ]"
    >
      <div class="flex items-start gap-2">
        <span class="text-sm font-medium opacity-70">
          {{ message.role === 'user' ? 'You' : 'Claude' }}
        </span>
        <span v-if="message.isPartial" class="text-xs opacity-50">typing...</span>
      </div>

      <div
        class="mt-1 prose prose-sm max-w-none"
        v-html="formatMarkdown(message.content)"
      />

      <div v-if="message.toolCalls?.length" class="mt-3 space-y-2">
        <ToolCallCard
          v-for="tool in message.toolCalls"
          :key="tool.id"
          :tool-call="tool"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.prose :deep(pre) {
  margin: 8px 0;
  padding: 12px;
  border-radius: 6px;
  background-color: var(--vscode-editor-background);
  border: 1px solid var(--vscode-editorWidget-border, rgba(255, 255, 255, 0.1));
  overflow-x: auto;
}

.prose :deep(code) {
  font-size: 0.85em;
  font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
}

.prose :deep(.inline-code) {
  background-color: var(--vscode-textCodeBlock-background, rgba(255, 255, 255, 0.1));
  padding: 2px 6px;
  border-radius: 4px;
}

.prose :deep(a) {
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
}

.prose :deep(a:hover) {
  text-decoration: underline;
}

.prose :deep(p) {
  margin: 8px 0;
}

.prose :deep(ul), .prose :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.prose :deep(li) {
  margin: 4px 0;
}

.prose :deep(blockquote) {
  border-left: 3px solid var(--vscode-textBlockQuote-border, #666);
  margin: 8px 0;
  padding-left: 12px;
  color: var(--vscode-textBlockQuote-foreground, #999);
}

.prose :deep(h1), .prose :deep(h2), .prose :deep(h3), .prose :deep(h4) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
}

.prose :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}

.prose :deep(th), .prose :deep(td) {
  border: 1px solid var(--vscode-editorWidget-border, rgba(255, 255, 255, 0.2));
  padding: 6px 12px;
  text-align: left;
}

.prose :deep(th) {
  background-color: var(--vscode-editor-background);
}

/* Highlight.js theme matching VS Code dark theme */
.prose :deep(.hljs) {
  color: var(--vscode-editor-foreground, #d4d4d4);
}

.prose :deep(.hljs-keyword),
.prose :deep(.hljs-selector-tag),
.prose :deep(.hljs-built_in),
.prose :deep(.hljs-name),
.prose :deep(.hljs-tag) {
  color: #569cd6;
}

.prose :deep(.hljs-string),
.prose :deep(.hljs-title),
.prose :deep(.hljs-section),
.prose :deep(.hljs-attribute),
.prose :deep(.hljs-literal),
.prose :deep(.hljs-template-tag),
.prose :deep(.hljs-template-variable),
.prose :deep(.hljs-type),
.prose :deep(.hljs-addition) {
  color: #ce9178;
}

.prose :deep(.hljs-comment),
.prose :deep(.hljs-quote),
.prose :deep(.hljs-deletion),
.prose :deep(.hljs-meta) {
  color: #6a9955;
}

.prose :deep(.hljs-number),
.prose :deep(.hljs-regexp),
.prose :deep(.hljs-selector-id),
.prose :deep(.hljs-selector-class) {
  color: #b5cea8;
}

.prose :deep(.hljs-attr),
.prose :deep(.hljs-variable),
.prose :deep(.hljs-template-variable),
.prose :deep(.hljs-link),
.prose :deep(.hljs-selector-attr),
.prose :deep(.hljs-selector-pseudo) {
  color: #9cdcfe;
}

.prose :deep(.hljs-function) {
  color: #dcdcaa;
}

.prose :deep(.hljs-symbol),
.prose :deep(.hljs-bullet) {
  color: #4fc1ff;
}

.prose :deep(.hljs-emphasis) {
  font-style: italic;
}

.prose :deep(.hljs-strong) {
  font-weight: bold;
}
</style>
