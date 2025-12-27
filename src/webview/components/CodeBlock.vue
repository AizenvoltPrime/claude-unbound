<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { Button } from '@/components/ui/button';
import { IconCheck, IconCopy } from '@/components/icons';
import { useCopyToClipboard } from '@/composables/useCopyToClipboard';
import { getHighlighter, getShikiTheme, normalizeLanguage, isLanguageLoaded } from '@/composables/useShikiHighlighter';

const props = defineProps<{
  code: string;
  language?: string;
}>();

const { hasCopied, copyToClipboard } = useCopyToClipboard();
const highlightedHtml = ref<string>('');
const isHovering = ref(false);
const isMounted = ref(true);

const normalizedLang = computed(() => normalizeLanguage(props.language));

const displayLanguage = computed(() => {
  const lang = props.language?.toLowerCase();
  if (!lang || lang === 'txt' || lang === 'text' || lang === 'plaintext') return null;
  return lang;
});

async function highlight() {
  if (!isMounted.value) return;

  const fallbackColor = getShikiTheme() === 'github-light' ? '#1f2328' : '#e6edf3';
  const fallbackHtml = `<pre style="padding:0;margin:0;color:${fallbackColor};"><code class="hljs">${escapeHtml(props.code)}</code></pre>`;

  if (!isLanguageLoaded(normalizedLang.value)) {
    highlightedHtml.value = fallbackHtml;
  }

  try {
    const highlighter = await getHighlighter(normalizedLang.value);
    if (!isMounted.value) return;

    const theme = getShikiTheme();
    const html = highlighter.codeToHtml(props.code, {
      lang: normalizedLang.value,
      theme,
      transformers: [
        {
          pre(node) {
            const baseColor = theme === 'github-light' ? '#1f2328' : '#e6edf3';
            node.properties.style = `padding:0;margin:0;background:transparent;color:${baseColor};`;
            return node;
          },
          code(node) {
            node.properties.class = `hljs language-${normalizedLang.value}`;
            return node;
          },
        },
      ],
    });

    if (isMounted.value) {
      highlightedHtml.value = html;
    }
  } catch (e) {
    console.error('[CodeBlock] Highlighting failed:', e);
    if (isMounted.value) {
      highlightedHtml.value = fallbackHtml;
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function handleCopy() {
  copyToClipboard(props.code);
}

watch(() => [props.code, props.language], highlight, { immediate: true });

onMounted(() => {
  isMounted.value = true;
});

onUnmounted(() => {
  isMounted.value = false;
});
</script>

<template>
  <div
    class="code-block-container group my-2 rounded-md border border-[#30363d] overflow-hidden"
    @mouseenter="isHovering = true"
    @mouseleave="isHovering = false"
  >
    <div class="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d]">
      <span
        v-if="displayLanguage"
        class="text-xs font-mono text-[#8b949e] select-none"
      >
        {{ displayLanguage }}
      </span>
      <span v-else></span>

      <Button
        variant="ghost"
        size="icon-sm"
        class="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#58a6ff] h-6 w-6 -mr-1"
        :class="{ 'opacity-100 text-green-400': hasCopied }"
        title="Copy code"
        @click="handleCopy"
      >
        <IconCheck v-if="hasCopied" :size="14" />
        <IconCopy v-else :size="14" />
      </Button>
    </div>

    <div class="code-block-content overflow-x-auto" v-html="highlightedHtml" />
  </div>
</template>

<style scoped>
.code-block-content {
  background: var(--vscode-editor-background, #0d1117);
  padding: 12px 16px;
  color: #e6edf3;
}

.code-block-content :deep(pre) {
  margin: 0;
  padding: 0;
  background: transparent !important;
}

.code-block-content :deep(code) {
  font-size: 0.85em;
  font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
  white-space: pre;
  background: transparent !important;
}

.code-block-content :deep(.line) {
  display: block;
  background: transparent !important;
}

.code-block-content :deep(span) {
  background: transparent !important;
}
</style>
