<script setup lang="ts">
import { computed } from 'vue';

interface FileEntry {
  path: string;
  operation: 'read' | 'edit' | 'write' | 'create';
}

const props = defineProps<{
  files: FileEntry[];
}>();

const operationIcons: Record<string, string> = {
  read: '📄',
  edit: '📝',
  write: '✏️',
  create: '➕',
};

const operationColors: Record<string, string> = {
  read: 'text-blue-400',
  edit: 'text-yellow-400',
  write: 'text-green-400',
  create: 'text-purple-400',
};

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function getDirectory(path: string): string {
  const parts = path.split(/[/\\]/);
  parts.pop();
  return parts.join('/') || '/';
}
</script>

<template>
  <div v-if="files.length > 0" class="border border-vscode-border rounded p-2">
    <div class="text-xs font-medium mb-2 opacity-70">Files Accessed</div>

    <div class="space-y-1">
      <div
        v-for="file in files"
        :key="file.path"
        class="flex items-center gap-2 text-xs"
      >
        <span :class="operationColors[file.operation]">
          {{ operationIcons[file.operation] }}
        </span>
        <span class="font-medium">{{ getFileName(file.path) }}</span>
        <span class="opacity-50 truncate">{{ getDirectory(file.path) }}</span>
      </div>
    </div>
  </div>
</template>
