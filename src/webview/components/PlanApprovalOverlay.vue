<script setup lang="ts">
import { ref, computed } from 'vue';
import { Button } from '@/components/ui/button';
import { IconArrowLeft, IconSparkles, IconCheck, IconPencil, IconPaperPlane } from '@/components/icons';
import MarkdownRenderer from './MarkdownRenderer.vue';
import { useOverlayEscape } from '@/composables/useOverlayEscape';

defineProps<{
  planContent: string;
}>();

const emit = defineEmits<{
  (e: 'approve', options: { approvalMode: 'acceptEdits' | 'manual' }): void;
  (e: 'feedback', text: string): void;
  (e: 'cancel'): void;
}>();

useOverlayEscape(() => emit('cancel'));

const feedbackText = ref('');
const canSubmitFeedback = computed(() => feedbackText.value.trim().length > 0);

function handleSendFeedback() {
  if (canSubmitFeedback.value) {
    emit('feedback', feedbackText.value.trim());
  }
}
</script>

<template>
  <div class="absolute inset-0 z-50 flex flex-col bg-background overflow-hidden">
    <!-- Header -->
    <header class="flex items-center gap-3 px-4 py-3 bg-muted border-b border-border/30 shrink-0">
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-foreground hover:bg-background shrink-0"
        @click="emit('cancel')"
      >
        <IconArrowLeft :size="18" />
      </Button>

      <IconSparkles :size="20" class="text-primary shrink-0" />

      <div class="flex-1 min-w-0">
        <h2 class="text-sm font-medium text-foreground">Ready to code?</h2>
        <p class="text-xs text-muted-foreground">Review Claude's plan before proceeding</p>
      </div>
    </header>

    <!-- Scrollable content -->
    <div class="flex-1 overflow-y-auto p-4">
      <MarkdownRenderer :content="planContent" />
    </div>

    <!-- Sticky footer -->
    <footer class="shrink-0 border-t border-border/30 bg-muted p-4 space-y-3">
      <textarea
        v-model="feedbackText"
        placeholder="Type feedback to revise the plan..."
        class="w-full min-h-20 p-3 rounded-md bg-background border border-border
               text-foreground placeholder:text-muted-foreground text-sm
               focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"
        @keydown.ctrl.enter="handleSendFeedback"
      />
      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="!canSubmitFeedback" @click="handleSendFeedback">
          <IconPaperPlane :size="16" class="mr-2" />
          Send Feedback
        </Button>
        <Button variant="outline" @click="emit('approve', { approvalMode: 'manual' })">
          <IconPencil :size="16" class="mr-2" />
          Yes, manually approve
        </Button>
        <Button @click="emit('approve', { approvalMode: 'acceptEdits' })">
          <IconCheck :size="16" class="mr-2" />
          Yes, auto-accept edits
        </Button>
      </div>
    </footer>
  </div>
</template>
