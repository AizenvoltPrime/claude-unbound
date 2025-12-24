<script setup lang="ts">
import { ref, computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

const props = defineProps<{
  visible: boolean;
  toolName?: string;
  filePath?: string;
  originalContent?: string;
  proposedContent?: string;
}>();

const emit = defineEmits<{
  (e: 'approve', approved: boolean, options?: { neverAskAgain?: boolean; customMessage?: string }): void;
}>();

const showCustomInput = ref(false);
const customMessage = ref('');

const fileName = computed(() => {
  if (!props.filePath) return '';
  return props.filePath.split(/[/\\]/).pop() || props.filePath;
});

const isNewFile = computed(() => !props.originalContent);

const lineCountChange = computed(() => {
  const originalLines = (props.originalContent || '').split('\n').length;
  const proposedLines = (props.proposedContent || '').split('\n').length;
  const diff = proposedLines - originalLines;
  if (isNewFile.value) return `${proposedLines} lines`;
  if (diff === 0) return 'No line count change';
  return diff > 0 ? `+${diff} lines` : `${diff} lines`;
});

function handleYes() {
  emit('approve', true);
  resetState();
}

function handleYesNeverAsk() {
  emit('approve', true, { neverAskAgain: true });
  resetState();
}

function handleNo() {
  emit('approve', false);
  resetState();
}

function handleCustom() {
  if (showCustomInput.value && customMessage.value.trim()) {
    emit('approve', false, { customMessage: customMessage.value.trim() });
    resetState();
  } else {
    showCustomInput.value = true;
  }
}

function handleCancel() {
  emit('approve', false);
  resetState();
}

function handleOpenChange(open: boolean) {
  if (!open) {
    handleCancel();
  }
}

function resetState() {
  showCustomInput.value = false;
  customMessage.value = '';
}
</script>

<template>
  <Dialog :open="visible" @update:open="handleOpenChange">
    <DialogContent class="bg-unbound-bg-card border-unbound-cyan-800/50 max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-unbound-text">
          <span class="text-lg">{{ toolName === 'Write' ? '📝' : '✏️' }}</span>
          <span>Allow {{ toolName?.toLowerCase() }} to {{ fileName }}?</span>
        </DialogTitle>
        <DialogDescription class="text-unbound-muted truncate">
          {{ filePath }}
        </DialogDescription>
      </DialogHeader>

      <!-- Content preview -->
      <div class="py-2">
        <div class="flex items-center gap-3 mb-4">
          <div class="flex-1">
            <div
              class="px-3 py-2 rounded text-sm"
              :class="isNewFile ? 'bg-green-900/20 border border-green-600/30 text-green-300' : 'bg-unbound-cyan-900/20 border border-unbound-cyan-700/30 text-unbound-cyan-300'"
            >
              <span v-if="isNewFile">New file: </span>
              <span v-else>Modifying: </span>
              <span class="font-medium">{{ lineCountChange }}</span>
            </div>
          </div>
        </div>

        <!-- Custom message input (shown when "Tell Claude" is clicked) -->
        <div v-if="showCustomInput" class="mb-4">
          <Label class="block mb-2 text-unbound-muted">Tell Claude what to do instead:</Label>
          <Textarea
            v-model="customMessage"
            class="min-h-20 bg-unbound-bg border-unbound-cyan-800/50 resize-none focus:border-unbound-cyan-500"
            placeholder="e.g., Use a different approach, rename the file, add error handling..."
            @keydown.enter.ctrl="handleCustom"
          />
        </div>
      </div>

      <!-- Action buttons -->
      <DialogFooter class="flex-col gap-2 sm:flex-col">
        <div v-if="!showCustomInput" class="grid grid-cols-2 gap-2 w-full">
          <!-- Yes button -->
          <Button @click="handleYes">
            <span class="mr-1">1</span> Yes
          </Button>

          <!-- Yes, don't ask again -->
          <Button variant="outline" @click="handleYesNeverAsk">
            <span class="mr-1">2</span> Yes, and don't ask again
          </Button>

          <!-- No -->
          <Button variant="outline" @click="handleNo">
            <span class="mr-1">3</span> No
          </Button>

          <!-- Tell Claude -->
          <Button variant="secondary" @click="handleCustom">
            Tell Claude what to do instead
          </Button>
        </div>

        <!-- Custom input action buttons -->
        <div v-else class="flex justify-end gap-2 w-full">
          <Button
            variant="ghost"
            @click="showCustomInput = false; customMessage = ''"
          >
            Back
          </Button>
          <Button
            :disabled="!customMessage.trim()"
            @click="handleCustom"
          >
            Send to Claude
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
