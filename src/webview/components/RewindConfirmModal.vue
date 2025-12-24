<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

defineProps<{
  visible: boolean;
  messagePreview?: string;
}>();

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();
</script>

<template>
  <AlertDialog :open="visible" @update:open="(open: boolean) => !open && emit('cancel')">
    <AlertDialogContent class="bg-vscode-bg border-vscode-border max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle class="flex items-center gap-2">
          Rewind Files
        </AlertDialogTitle>
        <AlertDialogDescription>
          <div class="flex items-start gap-3 mt-2">
            <span class="text-2xl shrink-0">⚠️</span>
            <div>
              <p class="mb-2 text-foreground">
                This will <strong>revert all file changes</strong> made after this point to their previous state.
              </p>
              <p class="text-sm opacity-70">
                File checkpoints are stored in memory. This action cannot be undone once the session ends.
              </p>
            </div>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div v-if="messagePreview" class="p-3 rounded bg-vscode-input-bg text-sm">
        <div class="text-xs opacity-50 mb-1">Rewind to after:</div>
        <div class="truncate italic">{{ messagePreview }}</div>
      </div>

      <Alert class="bg-yellow-900/20 border-yellow-600/30">
        <AlertTitle class="text-yellow-400 font-semibold">Note</AlertTitle>
        <AlertDescription class="text-sm opacity-80">
          Only file edits made by Claude will be reverted. Git history and external changes are unaffected.
        </AlertDescription>
      </Alert>

      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" @click="emit('cancel')">
            Cancel
          </Button>
        </AlertDialogCancel>
        <AlertDialogAction as-child>
          <Button
            class="bg-yellow-600 hover:bg-yellow-700"
            @click="emit('confirm')"
          >
            Rewind Files
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
