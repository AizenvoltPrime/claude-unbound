<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import MarkdownRenderer from './MarkdownRenderer.vue';
import { IconSparkles, IconCheck, IconPencil, IconPaperPlane } from '@/components/icons';

const props = defineProps<{
  visible: boolean;
  planContent: string;
  toolUseId: string;
}>();

const emit = defineEmits<{
  (e: 'approve', options: { approvalMode: 'acceptEdits' | 'manual' }): void;
  (e: 'feedback', text: string): void;
  (e: 'cancel'): void;
}>();

const showFeedbackInput = ref(false);
const feedbackText = ref('');

const canSubmitFeedback = computed(() => feedbackText.value.trim().length > 0);

watch(() => props.visible, (newVal) => {
  if (!newVal) {
    showFeedbackInput.value = false;
    feedbackText.value = '';
  }
});

function handleAutoAccept() {
  emit('approve', { approvalMode: 'acceptEdits' });
}

function handleManualApprove() {
  emit('approve', { approvalMode: 'manual' });
}

function handleSendFeedback() {
  if (canSubmitFeedback.value) {
    emit('feedback', feedbackText.value.trim());
    feedbackText.value = '';
    showFeedbackInput.value = false;
  }
}

function handleOpenChange(open: boolean) {
  if (!open) {
    emit('cancel');
  }
}
</script>

<template>
  <Dialog :open="visible" @update:open="handleOpenChange">
    <DialogContent class="bg-card border-border max-w-2xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <IconSparkles :size="20" class="text-primary" />
          Ready to code?
        </DialogTitle>
        <DialogDescription>
          Review Claude's plan before proceeding
        </DialogDescription>
      </DialogHeader>

      <Card class="border-border bg-muted/30 my-4 flex-1 overflow-hidden">
        <CardContent class="p-4 max-h-96 overflow-y-auto">
          <MarkdownRenderer :content="planContent" />
        </CardContent>
      </Card>

      <div v-if="showFeedbackInput" class="mb-4">
        <textarea
          v-model="feedbackText"
          placeholder="Type here to tell Claude what to change..."
          class="w-full min-h-24 p-3 rounded-md bg-background border border-border
                 text-foreground placeholder:text-muted-foreground
                 focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"
          @keydown.ctrl.enter="handleSendFeedback"
        />
        <div class="flex justify-end gap-2 mt-2">
          <Button variant="ghost" size="sm" @click="showFeedbackInput = false">
            Cancel
          </Button>
          <Button size="sm" :disabled="!canSubmitFeedback" @click="handleSendFeedback">
            Send Feedback
          </Button>
        </div>
      </div>

      <DialogFooter v-if="!showFeedbackInput" class="flex-col sm:flex-row gap-2">
        <Button
          variant="outline"
          class="flex items-center gap-2"
          @click="showFeedbackInput = true"
        >
          <IconPaperPlane :size="16" />
          Give Feedback
        </Button>
        <Button
          variant="outline"
          class="flex items-center gap-2"
          @click="handleManualApprove"
        >
          <IconPencil :size="16" />
          Yes, manually approve edits
        </Button>
        <Button
          class="flex items-center gap-2"
          @click="handleAutoAccept"
        >
          <IconCheck :size="16" />
          Yes, auto-accept edits
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
