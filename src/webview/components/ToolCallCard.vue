<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ToolCall } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';

const props = defineProps<{
  toolCall: ToolCall;
}>();

defineEmits<{
  (e: 'interrupt', toolId: string): void;
}>();

// Dialog state for expanded diff view
const isDialogOpen = ref(false);

// Detect file operation tools (Edit/Write)
const isFileOperation = computed(() =>
  props.toolCall.name === 'Edit' || props.toolCall.name === 'Write'
);

// Extract file path from input
const filePath = computed(() => {
  if ('file_path' in props.toolCall.input) {
    return props.toolCall.input.file_path as string;
  }
  return '';
});

// Diff statistics for Edit/Write tools
const diffStats = computed(() => {
  if (!isFileOperation.value) return null;

  const input = props.toolCall.input;
  let oldLines: string[] = [];
  let newLines: string[] = [];

  if (props.toolCall.name === 'Edit') {
    const oldString = (input.old_string as string) || '';
    const newString = (input.new_string as string) || '';
    oldLines = oldString ? oldString.split('\n') : [];
    newLines = newString ? newString.split('\n') : [];
  } else if (props.toolCall.name === 'Write') {
    // Write is all new content
    const content = (input.content as string) || '';
    newLines = content ? content.split('\n') : [];
  }

  const added = newLines.filter(l => !oldLines.includes(l)).length;
  const removed = oldLines.filter(l => !newLines.includes(l)).length;

  return { added, removed, oldLines, newLines };
});

// Summary text for Edit/Write
const diffSummary = computed(() => {
  if (!diffStats.value) return '';
  const { added, removed } = diffStats.value;
  const parts: string[] = [];
  if (added > 0) parts.push(`Added ${added} line${added !== 1 ? 's' : ''}`);
  if (removed > 0) parts.push(`Removed ${removed} line${removed !== 1 ? 's' : ''}`);
  return parts.join(', ') || 'No changes';
});

// Preview lines (first few added/changed lines for collapsed view)
const previewLines = computed(() => {
  if (!diffStats.value) return [];
  const { oldLines, newLines } = diffStats.value;

  // Get lines that are new (not in old)
  const addedLines = newLines.filter(l => !oldLines.includes(l));
  // Return first 5 non-empty lines
  return addedLines.filter(l => l.trim()).slice(0, 5);
});

// Max lines for LCS diff - beyond this, skip expensive diff and show simple view
const MAX_DIFF_LINES = 500;

// Compute LCS (Longest Common Subsequence) for proper diff
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // Build LCS table
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

// Full diff lines for expanded view using proper LCS-based diff
const diffLines = computed(() => {
  if (!diffStats.value) return [];
  const { oldLines, newLines } = diffStats.value;

  const result: Array<{
    type: 'unchanged' | 'removed' | 'added';
    content: string;
    lineNum: number;
  }> = [];

  // Skip expensive LCS for large files - show simplified view instead
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    // Show all old lines as removed, then all new lines as added
    oldLines.forEach((line, i) => {
      result.push({ type: 'removed', content: line, lineNum: i + 1 });
    });
    newLines.forEach((line, i) => {
      result.push({ type: 'added', content: line, lineNum: oldLines.length + i + 1 });
    });
    return result;
  }

  if (props.toolCall.name === 'Write') {
    // For Write, all lines are "added"
    newLines.forEach((line, i) => {
      result.push({ type: 'added', content: line, lineNum: i + 1 });
    });
    return result;
  }

  // For Edit, compute proper diff using LCS
  const lcs = computeLCS(oldLines, newLines);

  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;
  let lineNum = 1;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];
    const lcsLine = lcs[lcsIdx];

    // If both match LCS, it's unchanged
    if (oldLine === lcsLine && newLine === lcsLine) {
      result.push({ type: 'unchanged', content: newLine, lineNum: lineNum++ });
      oldIdx++;
      newIdx++;
      lcsIdx++;
    }
    // If old line doesn't match LCS, it was removed
    else if (oldIdx < oldLines.length && oldLine !== lcsLine) {
      result.push({ type: 'removed', content: oldLine, lineNum: lineNum++ });
      oldIdx++;
    }
    // If new line doesn't match LCS, it was added
    else if (newIdx < newLines.length && newLine !== lcsLine) {
      result.push({ type: 'added', content: newLine, lineNum: lineNum++ });
      newIdx++;
    }
    // Edge case: move forward
    else {
      if (newIdx < newLines.length) {
        result.push({ type: 'added', content: newLine, lineNum: lineNum++ });
        newIdx++;
      } else if (oldIdx < oldLines.length) {
        result.push({ type: 'removed', content: oldLine, lineNum: lineNum++ });
        oldIdx++;
      }
    }
  }

  return result;
});

const statusIcon = computed(() => {
  switch (props.toolCall.status) {
    case 'pending':
      return '⏳';
    case 'running':
      return '⚙️';
    case 'awaiting_approval':
      return '🔒';
    case 'approved':
      return '✅';
    case 'denied':
      return '❌';
    case 'completed':
      return '✓';
    case 'failed':
      return '⚠️';
    case 'abandoned':
      return '⊘';  // Not executed
    default:
      return '•';
  }
});

const statusClass = computed(() => {
  switch (props.toolCall.status) {
    case 'pending':
      return 'text-yellow-500';
    case 'running':
      return 'text-blue-500 animate-spin-slow';
    case 'awaiting_approval':
      return 'text-amber-500 animate-pulse';
    case 'approved':
    case 'completed':
      return 'text-green-500';
    case 'denied':
    case 'failed':
      return 'text-red-500';
    case 'abandoned':
      return 'text-gray-400';  // Muted - not executed
    default:
      return 'text-gray-500';
  }
});

const isRunning = computed(() => props.toolCall.status === 'running');
const isFailed = computed(() => props.toolCall.status === 'failed');
const isAbandoned = computed(() => props.toolCall.status === 'abandoned');
const isAwaitingApproval = computed(() => props.toolCall.status === 'awaiting_approval');

const cardClass = computed(() => {
  if (isFailed.value) return 'border-red-500/50';
  if (isAbandoned.value) return 'border-gray-500/50 opacity-60';
  return 'border-unbound-cyan-800/50';
});

const toolIcon = computed(() => {
  const icons: Record<string, string> = {
    Read: '📄',
    Write: '✏️',
    Edit: '📝',
    Bash: '💻',
    Glob: '🔍',
    Grep: '🔎',
    WebFetch: '🌐',
    WebSearch: '🔍',
    LSP: '🔧',
    Task: '📋',
  };
  return icons[props.toolCall.name] || '🔧';
});

function formatInput(input: Record<string, unknown>): string {
  // Show a concise summary of the tool input
  if ('file_path' in input) {
    return input.file_path as string;
  }
  if ('command' in input) {
    const cmd = input.command as string;
    return cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd;
  }
  if ('pattern' in input) {
    return `Pattern: ${input.pattern}`;
  }
  if ('query' in input) {
    return `Query: ${input.query}`;
  }
  if ('url' in input) {
    return input.url as string;
  }
  return JSON.stringify(input).slice(0, 60) + '...';
}
</script>

<template>
  <Card class="text-sm overflow-hidden" :class="cardClass">
    <!-- Header: Tool name and status -->
    <CardHeader class="flex flex-row items-center gap-2 px-3 py-1.5 bg-unbound-bg-card border-b border-unbound-cyan-900/30 space-y-0">
      <span class="text-lg">{{ toolIcon }}</span>
      <span class="text-unbound-cyan-400 font-medium">{{ toolCall.name }}</span>
      <!-- For file ops, show file path -->
      <span v-if="isFileOperation && filePath" class="text-unbound-muted text-xs truncate max-w-[300px]">
        {{ filePath }}
      </span>
      <span :class="statusClass" class="ml-auto">{{ statusIcon }}</span>

      <!-- Running indicator with interrupt button -->
      <Button
        v-if="isRunning"
        variant="destructive"
        size="sm"
        class="h-6 px-2 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/40"
        @click="$emit('interrupt', toolCall.id)"
        title="Interrupt this tool"
      >
        Stop
      </Button>
    </CardHeader>

    <!-- Body: Special rendering for Edit/Write tools -->
    <CardContent v-if="isFileOperation && diffStats" class="bg-unbound-bg p-0">
      <!-- Diff summary -->
      <div class="px-3 py-2 text-xs text-unbound-muted">
        {{ diffSummary }}
      </div>

      <!-- Code preview (collapsed view) -->
      <div
        v-if="previewLines.length > 0"
        class="relative group cursor-pointer"
        @click="isDialogOpen = true"
      >
        <div class="px-3 py-2 bg-unbound-bg-card/50 border-t border-unbound-cyan-900/20 overflow-hidden max-h-32">
          <pre class="text-xs font-mono leading-relaxed m-0 p-0"><code><div
  v-for="(line, idx) in previewLines"
  :key="idx"
  class="px-2 py-0.5 bg-green-900/40 text-green-300"
><span class="text-green-400 mr-1 select-none">+</span>{{ line }}</div></code></pre>
        </div>

        <!-- Click to expand overlay -->
        <div class="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
          <Button
            variant="secondary"
            size="sm"
            class="opacity-0 group-hover:opacity-100 transition-opacity text-xs"
          >
            Click to expand
          </Button>
        </div>
      </div>

      <!-- Error message for failed tools -->
      <Alert
        v-if="isFailed && toolCall.errorMessage"
        variant="destructive"
        class="m-3 p-2 text-xs bg-red-900/20 border-red-500/30"
      >
        <AlertTitle class="text-red-400 font-semibold mb-0">Error</AlertTitle>
        <AlertDescription class="text-red-400">{{ toolCall.errorMessage }}</AlertDescription>
      </Alert>

      <!-- Awaiting approval indicator -->
      <Alert
        v-if="isAwaitingApproval"
        class="m-3 p-2 text-xs bg-amber-900/20 border-amber-500/30 animate-pulse"
      >
        <AlertTitle class="text-amber-400 font-semibold mb-0">Awaiting your approval</AlertTitle>
        <AlertDescription class="text-amber-400">Please respond to the dialog</AlertDescription>
      </Alert>

      <!-- Running state progress indicator -->
      <div v-if="isRunning" class="h-0.5 bg-unbound-bg-card rounded overflow-hidden mx-3 mb-2">
        <div class="h-full bg-unbound-cyan-500 animate-progress"></div>
      </div>

      <!-- Expanded diff dialog -->
      <Dialog v-model:open="isDialogOpen">
        <DialogContent class="max-w-4xl max-h-[80vh] p-0 bg-unbound-bg border-unbound-cyan-800/50">
          <DialogHeader class="px-4 py-3 border-b border-unbound-cyan-900/30 flex flex-row items-center justify-between space-y-0">
            <DialogTitle class="text-sm font-mono text-unbound-text">{{ filePath }}</DialogTitle>
            <DialogClose class="text-unbound-muted hover:text-unbound-text" />
          </DialogHeader>

          <div class="overflow-auto max-h-[calc(80vh-60px)]">
            <pre class="text-xs font-mono leading-relaxed m-0 p-0"><code><div
  v-for="(line, idx) in diffLines"
  :key="idx"
  :class="[
    'px-4 py-0.5',
    line.type === 'added' ? 'bg-green-900/40 text-green-300' : '',
    line.type === 'removed' ? 'bg-red-900/40 text-red-300' : '',
    line.type === 'unchanged' ? 'text-unbound-text' : '',
  ]"
><span class="opacity-50 mr-3 select-none w-8 inline-block text-right">{{ line.lineNum }}</span><span class="mr-1 select-none" :class="line.type === 'added' ? 'text-green-400' : line.type === 'removed' ? 'text-red-400' : 'opacity-0'">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span>{{ line.content }}</div></code></pre>
          </div>
        </DialogContent>
      </Dialog>
    </CardContent>

    <!-- Body: Standard rendering for other tools -->
    <CardContent v-else class="bg-unbound-bg p-3 space-y-2">
      <!-- Input display -->
      <div class="flex items-start gap-2 text-xs">
        <span class="text-unbound-cyan-500 font-medium shrink-0">IN</span>
        <span class="font-mono text-unbound-muted truncate">{{ formatInput(toolCall.input) }}</span>
      </div>

      <!-- Error message for failed tools -->
      <Alert
        v-if="isFailed && toolCall.errorMessage"
        variant="destructive"
        class="p-2 text-xs bg-red-900/20 border-red-500/30"
      >
        <AlertTitle class="text-red-400 font-semibold mb-0">Error</AlertTitle>
        <AlertDescription class="text-red-400">{{ toolCall.errorMessage }}</AlertDescription>
      </Alert>

      <!-- Normal result display -->
      <div
        v-else-if="toolCall.result"
        class="text-xs"
      >
        <div class="flex items-start gap-2">
          <span class="text-unbound-cyan-500 font-medium shrink-0">OUT</span>
          <span
            class="font-mono overflow-x-auto"
            :class="toolCall.isError ? 'text-red-400' : 'text-unbound-accent'"
          >
            {{ toolCall.result.slice(0, 200) }}{{ toolCall.result.length > 200 ? '...' : '' }}
          </span>
        </div>
      </div>

      <!-- Awaiting approval indicator -->
      <Alert
        v-if="isAwaitingApproval"
        class="p-2 text-xs bg-amber-900/20 border-amber-500/30 animate-pulse"
      >
        <AlertTitle class="text-amber-400 font-semibold mb-0">Awaiting your approval</AlertTitle>
        <AlertDescription class="text-amber-400">Please respond to the dialog</AlertDescription>
      </Alert>

      <!-- Abandoned indicator -->
      <Alert
        v-if="isAbandoned"
        class="p-2 text-xs bg-gray-800/40 border-gray-600/30"
      >
        <AlertTitle class="text-gray-400 font-semibold mb-0">Not executed</AlertTitle>
        <AlertDescription class="text-gray-400">Claude changed course before running this tool</AlertDescription>
      </Alert>

      <!-- Running state progress indicator -->
      <div v-if="isRunning" class="h-0.5 bg-unbound-bg-card rounded overflow-hidden">
        <div class="h-full bg-unbound-cyan-500 animate-progress"></div>
      </div>
    </CardContent>
  </Card>
</template>

<style scoped>
@keyframes progress {
  0% {
    transform: translateX(-100%);
    width: 30%;
  }
  50% {
    width: 50%;
  }
  100% {
    transform: translateX(400%);
    width: 30%;
  }
}

.animate-progress {
  animation: progress 1.5s ease-in-out infinite;
}

.animate-spin-slow {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
