<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
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
import {
  IconGear,
  IconLock,
  IconCheckCircle,
  IconXCircle,
  IconCheck,
  IconWarning,
  IconBan,
  IconFile,
  IconPencil,
  IconPencilSquare,
  IconTerminal,
  IconSearch,
  IconGlobe,
  IconWrench,
  IconClipboard,
} from '@/components/icons';
import LoadingSpinner from './LoadingSpinner.vue';
import DiffView from './DiffView.vue';

const props = defineProps<{
  toolCall: ToolCall;
}>();

defineEmits<{
  (e: 'interrupt', toolId: string): void;
}>();

const isDialogOpen = ref(false);

const isFileOperation = computed(() =>
  props.toolCall.name === 'Edit' || props.toolCall.name === 'Write'
);

const filePath = computed(() => {
  if ('file_path' in props.toolCall.input) {
    return props.toolCall.input.file_path as string;
  }
  return '';
});

const isNewFile = computed(() => props.toolCall.name === 'Write');

const diffContent = computed(() => {
  if (!isFileOperation.value) return null;

  const input = props.toolCall.input;

  if (props.toolCall.name === 'Edit') {
    return {
      oldContent: (input.old_string as string) || '',
      newContent: (input.new_string as string) || '',
    };
  }

  return {
    oldContent: '',
    newContent: (input.content as string) || '',
  };
});

const diffStats = computed(() => {
  if (!diffContent.value) return null;

  const oldLines = diffContent.value.oldContent
    ? diffContent.value.oldContent.split('\n')
    : [];
  const newLines = diffContent.value.newContent
    ? diffContent.value.newContent.split('\n')
    : [];

  const added = newLines.filter(l => !oldLines.includes(l)).length;
  const removed = oldLines.filter(l => !newLines.includes(l)).length;

  return { added, removed };
});

const diffSummary = computed(() => {
  if (!diffStats.value) return '';
  const { added, removed } = diffStats.value;
  const parts: string[] = [];
  if (added > 0) parts.push(`Added ${added} line${added !== 1 ? 's' : ''}`);
  if (removed > 0) parts.push(`Removed ${removed} line${removed !== 1 ? 's' : ''}`);
  return parts.join(', ') || 'No changes';
});

const previewLines = computed(() => {
  if (!diffContent.value) return [];
  const { oldContent, newContent } = diffContent.value;
  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent ? newContent.split('\n') : [];

  const addedLines = newLines.filter(l => !oldLines.includes(l));
  return addedLines.filter(l => l.trim()).slice(0, 5);
});

const isPending = computed(() => props.toolCall.status === 'pending');

const statusIconComponent = computed((): Component | null => {
  switch (props.toolCall.status) {
    case 'pending':
      return null;
    case 'running':
      return IconGear;
    case 'awaiting_approval':
      return IconLock;
    case 'approved':
      return IconCheckCircle;
    case 'denied':
      return IconXCircle;
    case 'completed':
      return IconCheck;
    case 'failed':
      return IconWarning;
    case 'abandoned':
      return IconBan;
    default:
      return IconGear;
  }
});

const statusClass = computed(() => {
  switch (props.toolCall.status) {
    case 'pending':
      return 'text-unbound-cyan-400';
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
      return 'text-gray-400';
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

const toolIconComponent = computed((): Component => {
  const icons: Record<string, Component> = {
    Read: IconFile,
    Write: IconPencil,
    Edit: IconPencilSquare,
    Bash: IconTerminal,
    Glob: IconSearch,
    Grep: IconSearch,
    WebFetch: IconGlobe,
    WebSearch: IconSearch,
    LSP: IconWrench,
    Task: IconClipboard,
  };
  return icons[props.toolCall.name] || IconWrench;
});

function formatInput(input: Record<string, unknown>): string {
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
    <CardHeader class="flex flex-row items-center gap-2 px-3 py-1.5 bg-unbound-bg-card border-b border-unbound-cyan-900/30 space-y-0">
      <component :is="toolIconComponent" :size="18" class="text-unbound-cyan-400 shrink-0" />
      <span class="text-unbound-cyan-400 font-medium">{{ toolCall.name }}</span>
      <span v-if="isFileOperation && filePath" class="text-unbound-muted text-xs truncate max-w-[300px]">
        {{ filePath }}
      </span>
      <LoadingSpinner v-if="isPending" :size="16" :class="statusClass" class="ml-auto shrink-0" />
      <component v-else :is="statusIconComponent" :size="16" :class="statusClass" class="ml-auto shrink-0" />

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

    <CardContent v-if="isFileOperation && diffContent" class="bg-unbound-bg p-0">
      <div class="px-3 py-2 text-xs text-unbound-muted">
        {{ diffSummary }}
      </div>

      <div
        v-if="previewLines.length > 0"
        class="relative group cursor-pointer"
        @click="isDialogOpen = true"
      >
        <div class="px-3 py-2 bg-unbound-bg-card/50 border-t border-unbound-cyan-900/20 overflow-hidden max-h-32">
          <pre class="text-xs font-mono leading-relaxed m-0 p-0"><code><div
  v-for="(line, idx) in previewLines"
  :key="idx"
  class="px-2 py-0.5 diff-added"
><span class="diff-added-indicator mr-1 select-none">+</span>{{ line }}</div></code></pre>
        </div>

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

      <div
        v-if="isFailed && toolCall.errorMessage"
        class="px-3 py-2 border-t border-red-500/20 bg-red-950/30"
      >
        <div class="flex items-start gap-2 text-xs">
          <IconXCircle :size="14" class="text-red-400 shrink-0 mt-0.5" />
          <span class="text-red-300">{{ toolCall.errorMessage }}</span>
        </div>
      </div>

      <Alert
        v-if="isAwaitingApproval"
        class="m-3 p-2 text-xs bg-amber-900/20 border-amber-500/30 animate-pulse"
      >
        <AlertTitle class="text-amber-400 font-semibold mb-0">Awaiting your approval</AlertTitle>
        <AlertDescription class="text-amber-400">Please respond to the dialog</AlertDescription>
      </Alert>

      <div v-if="isRunning" class="h-0.5 bg-unbound-bg-card rounded overflow-hidden mx-3 mb-2">
        <div class="h-full bg-unbound-cyan-500 animate-progress"></div>
      </div>

      <Dialog v-model:open="isDialogOpen">
        <DialogContent class="max-w-4xl max-h-[80vh] p-0 bg-unbound-bg border-unbound-cyan-800/50">
          <DialogHeader class="px-4 py-3 border-b border-unbound-cyan-900/30 flex flex-row items-center justify-between space-y-0">
            <DialogTitle class="text-sm font-mono text-unbound-text">{{ filePath }}</DialogTitle>
            <DialogClose class="text-unbound-muted hover:text-unbound-text" />
          </DialogHeader>

          <div class="p-0">
            <DiffView
              :old-content="diffContent.oldContent"
              :new-content="diffContent.newContent"
              :file-name="filePath"
              :is-new-file="isNewFile"
              :show-header="false"
              max-height="calc(80vh - 60px)"
            />
          </div>
        </DialogContent>
      </Dialog>
    </CardContent>

    <CardContent v-else class="bg-unbound-bg p-3 space-y-2">
      <div class="flex items-start gap-2 text-xs">
        <span class="text-unbound-cyan-500 font-medium shrink-0">IN</span>
        <span class="font-mono text-unbound-muted truncate">{{ formatInput(toolCall.input) }}</span>
      </div>

      <div
        v-if="isFailed && toolCall.errorMessage"
        class="flex items-start gap-2 text-xs border-t border-red-500/20 pt-2 -mx-3 px-3 bg-red-950/30 -mb-3 pb-3"
      >
        <IconXCircle :size="14" class="text-red-400 shrink-0 mt-0.5" />
        <span class="text-red-300">{{ toolCall.errorMessage }}</span>
      </div>

      <div
        v-else-if="toolCall.result"
        class="text-xs border-t border-unbound-cyan-900/30 pt-2"
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

      <Alert
        v-if="isAwaitingApproval"
        class="p-2 text-xs bg-amber-900/20 border-amber-500/30 animate-pulse"
      >
        <AlertTitle class="text-amber-400 font-semibold mb-0">Awaiting your approval</AlertTitle>
        <AlertDescription class="text-amber-400">Please respond to the dialog</AlertDescription>
      </Alert>

      <Alert
        v-if="isAbandoned"
        class="p-2 text-xs bg-gray-800/40 border-gray-600/30"
      >
        <AlertTitle class="text-gray-400 font-semibold mb-0">Not executed</AlertTitle>
        <AlertDescription class="text-gray-400">Claude changed course before running this tool</AlertDescription>
      </Alert>

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

.diff-added {
  background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(34, 197, 94, 0.2));
  color: var(--vscode-diffEditor-insertedTextForeground, #86efac);
}

.diff-added-indicator {
  color: var(--vscode-gitDecoration-addedResourceForeground, #4ade80);
}
</style>
