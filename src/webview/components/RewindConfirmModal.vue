<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { IconWarning } from '@/components/icons';
import type { RewindOption } from '@shared/types';

const props = defineProps<{
  visible: boolean;
  messagePreview?: string;
  filesAffected?: number;
  linesChanged?: { added: number; removed: number };
}>();

const emit = defineEmits<{
  confirm: [option: RewindOption];
  cancel: [];
}>();

const selectedIndex = ref(-1);

const options: { key: RewindOption; label: string; description: string; shortcut: string }[] = [
  {
    key: 'code-and-conversation',
    label: 'Restore code and conversation',
    description: 'Revert files and remove messages after this point',
    shortcut: '1',
  },
  {
    key: 'conversation-only',
    label: 'Restore conversation only',
    description: 'Remove messages but keep current file state',
    shortcut: '2',
  },
  {
    key: 'code-only',
    label: 'Restore code only',
    description: 'Revert files but keep conversation history',
    shortcut: '3',
  },
  {
    key: 'cancel',
    label: 'Cancel',
    description: 'Do not rewind',
    shortcut: '4',
  },
];

watch(() => props.visible, (visible) => {
  if (visible) {
    selectedIndex.value = -1;
  }
});

function handleKeyDown(event: KeyboardEvent) {
  if (!props.visible) return;

  const target = event.target as HTMLElement;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable) return;

  switch (event.key) {
    case '1':
    case '2':
    case '3':
    case '4': {
      event.preventDefault();
      const index = parseInt(event.key) - 1;
      selectOption(index);
      break;
    }
    case 'ArrowUp':
      event.preventDefault();
      if (selectedIndex.value <= 0) {
        selectedIndex.value = options.length - 1;
      } else {
        selectedIndex.value--;
      }
      break;
    case 'ArrowDown':
      event.preventDefault();
      if (selectedIndex.value < 0 || selectedIndex.value >= options.length - 1) {
        selectedIndex.value = 0;
      } else {
        selectedIndex.value++;
      }
      break;
    case 'Enter':
      event.preventDefault();
      if (selectedIndex.value >= 0) {
        selectOption(selectedIndex.value);
      }
      break;
    case 'Escape':
      event.preventDefault();
      emit('cancel');
      break;
  }
}

function selectOption(index: number) {
  const option = options[index];
  if (option.key === 'cancel') {
    emit('cancel');
  } else {
    emit('confirm', option.key);
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <AlertDialog :open="visible" @update:open="(open: boolean) => !open && emit('cancel')">
    <AlertDialogContent class="bg-card border-border max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle class="flex items-center gap-2">
          Restore Options
        </AlertDialogTitle>
        <AlertDialogDescription>
          <div class="flex items-start gap-3 mt-2">
            <IconWarning :size="24" class="shrink-0 text-warning" />
            <div>
              <p class="mb-2 text-foreground">
                Choose how to restore to this point in the conversation.
              </p>
            </div>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div v-if="messagePreview" class="p-3 rounded bg-muted text-sm">
        <div class="text-xs text-muted-foreground mb-1">Rewind to after:</div>
        <div class="truncate italic">"{{ messagePreview }}"</div>
      </div>

      <div v-if="filesAffected" class="flex items-center gap-3 text-xs text-muted-foreground px-1">
        <span>{{ filesAffected }} files affected</span>
        <template v-if="linesChanged">
          <span class="text-success">+{{ linesChanged.added }}</span>
          <span class="text-error">-{{ linesChanged.removed }}</span>
        </template>
      </div>

      <div class="space-y-2">
        <button
          v-for="(option, index) in options"
          :key="option.key"
          class="w-full p-3 rounded-lg text-left transition-all flex items-start gap-3 cursor-pointer"
          :class="index === selectedIndex
            ? 'bg-primary/60 border border-primary'
            : 'bg-muted border border-transparent hover:bg-muted/80'"
          @click="selectOption(index)"
          @mouseenter="selectedIndex = index"
        >
          <span
            class="shrink-0 w-6 h-6 rounded flex items-center justify-center text-sm font-mono leading-none"
            :class="index === selectedIndex
              ? 'bg-primary text-primary-foreground'
              : 'bg-border text-muted-foreground'"
          >
            {{ option.shortcut }}
          </span>
          <div>
            <div class="font-medium text-sm">{{ option.label }}</div>
            <div class="text-xs text-muted-foreground mt-0.5">{{ option.description }}</div>
          </div>
        </button>
      </div>

      <Alert class="bg-warning/20 border-warning/30">
        <AlertTitle class="text-warning font-semibold text-xs">Note</AlertTitle>
        <AlertDescription class="text-xs text-foreground/70">
          File checkpoints are stored in memory. This action cannot be undone once the session ends.
        </AlertDescription>
      </Alert>

      <div class="pt-2 text-xs text-muted-foreground flex items-center gap-4">
        <span class="flex items-center gap-1">
          <kbd class="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">1-4</kbd>
          <span>or</span>
          <kbd class="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">↑↓</kbd>
          <kbd class="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Enter</kbd>
        </span>
      </div>
    </AlertDialogContent>
  </AlertDialog>
</template>
