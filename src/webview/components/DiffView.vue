<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { Button } from '@/components/ui/button';
import { IconCheck, IconCopy } from '@/components/icons';
import { useCopyToClipboard } from '@/composables/useCopyToClipboard';
import {
  computeDiff,
  computeNewFileOnlyDiff,
  getLanguageFromPath,
  type DiffLine,
} from '@/utils/parseUnifiedDiff';
import { highlightDiffLines, type HighlightedDiffLine } from '@/utils/highlightDiff';
import { escapeHtml } from '@/utils/stringUtils';

const props = withDefaults(
  defineProps<{
    oldContent?: string;
    newContent: string;
    fileName: string;
    showActions?: boolean;
    showHeader?: boolean;
    maxHeight?: string;
    isNewFile?: boolean;
  }>(),
  {
    oldContent: '',
    showActions: false,
    showHeader: true,
    maxHeight: '400px',
    isNewFile: false,
  }
);

const emit = defineEmits<{
  approve: [];
  reject: [];
}>();

const { hasCopied, copyToClipboard } = useCopyToClipboard();
const isHovering = ref(false);
const highlightedLines = ref<HighlightedDiffLine[]>([]);
const isMounted = ref(true);

const diffResult = computed(() => {
  if (props.isNewFile || !props.oldContent) {
    return computeNewFileOnlyDiff(props.newContent);
  }
  return computeDiff(props.oldContent, props.newContent);
});

const language = computed(() => getLanguageFromPath(props.fileName));

const diffSummary = computed(() => {
  const { added, removed } = diffResult.value.stats;
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`-${removed}`);
  return parts.join(' / ') || 'No changes';
});

async function highlightLines() {
  if (!isMounted.value) return;

  const lines = diffResult.value.lines;
  try {
    const result = await highlightDiffLines(lines, language.value);
    if (isMounted.value) {
      highlightedLines.value = result;
    }
  } catch {
    if (isMounted.value) {
      highlightedLines.value = lines.map((l) => ({
        ...l,
        highlightedContent: escapeHtml(l.content),
      }));
    }
  }
}

function handleCopyNewContent() {
  copyToClipboard(props.newContent);
}

function getLineTypeClass(type: DiffLine['type']): string {
  switch (type) {
    case 'addition':
      return 'diff-added';
    case 'deletion':
      return 'diff-removed';
    case 'gap':
      return 'diff-gap';
    default:
      return '';
  }
}

function getLineIndicator(type: DiffLine['type']): string {
  switch (type) {
    case 'addition':
      return '+';
    case 'deletion':
      return '-';
    default:
      return ' ';
  }
}

watch(
  () => [props.oldContent, props.newContent, props.fileName],
  highlightLines,
  { immediate: true }
);

onMounted(() => {
  isMounted.value = true;
});

onUnmounted(() => {
  isMounted.value = false;
});
</script>

<template>
  <div
    class="diff-view overflow-hidden"
    :class="showHeader ? 'border border-vscode-border rounded' : ''"
    @mouseenter="isHovering = true"
    @mouseleave="isHovering = false"
  >
    <div
      v-if="showHeader"
      class="diff-header bg-vscode-input-bg px-3 py-2 border-b border-vscode-border flex justify-between items-center gap-2"
    >
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-medium text-sm truncate">{{ fileName }}</span>
        <span class="text-xs text-unbound-muted shrink-0">{{ diffSummary }}</span>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          class="h-6 w-6 opacity-0 transition-opacity text-unbound-muted hover:text-unbound-text"
          :class="{ 'opacity-100': isHovering || hasCopied, 'text-green-400': hasCopied }"
          title="Copy new content"
          @click="handleCopyNewContent"
        >
          <IconCheck v-if="hasCopied" :size="14" />
          <IconCopy v-else :size="14" />
        </Button>

        <template v-if="showActions">
          <Button variant="destructive" size="sm" @click="emit('reject')">
            Reject
          </Button>
          <Button size="sm" class="bg-green-600 hover:bg-green-700" @click="emit('approve')">
            Approve
          </Button>
        </template>
      </div>
    </div>

    <div class="diff-content overflow-x-auto overflow-y-auto" :style="{ maxHeight }">
      <table class="diff-table w-full text-xs font-mono">
        <tbody>
          <template v-for="(line, idx) in highlightedLines" :key="idx">
            <tr v-if="line.type === 'gap'" class="diff-gap-row">
              <td colspan="4" class="text-center py-1 text-unbound-muted text-xs">
                <span v-if="line.hiddenCount">{{ line.hiddenCount }} hidden lines</span>
                <span v-else>───</span>
              </td>
            </tr>
            <tr v-else :class="getLineTypeClass(line.type)">
              <td class="diff-line-num old-num select-none text-right pr-1 opacity-50 w-10">
                {{ line.oldLineNum ?? '' }}
              </td>
              <td class="diff-line-num new-num select-none text-right pr-2 opacity-50 w-10 border-r border-vscode-border">
                {{ line.newLineNum ?? '' }}
              </td>
              <td class="diff-indicator select-none w-4 text-center">
                <span
                  :class="line.type === 'addition' ? 'text-green-400' : line.type === 'deletion' ? 'text-red-400' : 'opacity-0'"
                >{{ getLineIndicator(line.type) }}</span>
              </td>
              <td class="diff-content-cell pl-1 whitespace-pre">
                <span v-html="line.highlightedContent || '&nbsp;'" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.diff-view {
  background: var(--vscode-editor-background, #0d1117);
}

.diff-table {
  border-collapse: collapse;
}

.diff-table tr {
  line-height: 1.4;
}

.diff-table td {
  padding: 1px 4px;
  vertical-align: top;
}

.diff-line-num {
  color: var(--vscode-editorLineNumber-foreground, #6e7681);
  min-width: 40px;
}

.diff-added {
  background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(34, 197, 94, 0.15));
}

.diff-removed {
  background-color: var(--vscode-diffEditor-removedTextBackground, rgba(239, 68, 68, 0.15));
}

.diff-gap-row {
  background-color: var(--vscode-editorGroup-border, rgba(128, 128, 128, 0.1));
}

.diff-content-cell {
  word-break: break-all;
}

.diff-content-cell :deep(span) {
  background: transparent !important;
}
</style>
