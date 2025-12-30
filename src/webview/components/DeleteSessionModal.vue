<script setup lang="ts">
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { IconWarning } from '@/components/icons';

defineProps<{
  visible: boolean;
  sessionName?: string;
}>();

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

function handleConfirm() {
  emit('confirm');
}

function handleCancel() {
  emit('cancel');
}
</script>

<template>
  <AlertDialog :open="visible" @update:open="(open: boolean) => !open && handleCancel()">
    <AlertDialogContent class="bg-card border-border max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle class="flex items-center gap-2">
          <IconWarning :size="20" class="text-error" />
          Delete Session
        </AlertDialogTitle>
        <AlertDialogDescription>
          <p class="text-foreground">
            Delete this session? This action cannot be undone.
          </p>
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div v-if="sessionName" class="p-3 rounded bg-muted text-sm overflow-hidden">
        <div class="text-xs text-muted-foreground mb-1">Session:</div>
        <div class="break-words">{{ sessionName }}</div>
      </div>

      <div class="flex justify-end gap-2 mt-4">
        <Button variant="ghost" @click="handleCancel">
          Cancel
        </Button>
        <Button
          class="bg-destructive hover:bg-destructive/80 text-destructive-foreground"
          @click="handleConfirm"
        >
          Delete
        </Button>
      </div>
    </AlertDialogContent>
  </AlertDialog>
</template>
