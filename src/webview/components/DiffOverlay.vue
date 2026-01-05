<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExpandedDiff } from '@/stores/useDiffStore';
import { Button } from '@/components/ui/button';
import { IconArrowLeft, IconPencilSquare, IconPencil } from '@/components/icons';
import DiffView from './DiffView.vue';
import { computeDiff, computeNewFileOnlyDiff } from '@/utils/parseUnifiedDiff';
import { useOverlayEscape } from '@/composables/useOverlayEscape';

const { t } = useI18n();

const props = defineProps<{
  diff: ExpandedDiff;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

useOverlayEscape(() => emit('close'));

const fileName = computed(() => {
  const parts = props.diff.filePath.split(/[/\\]/);
  return parts[parts.length - 1] || props.diff.filePath;
});

const diffStats = computed(() => {
  const result = props.diff.isNewFile || !props.diff.oldContent
    ? computeNewFileOnlyDiff(props.diff.newContent)
    : computeDiff(props.diff.oldContent, props.diff.newContent);

  return result.stats;
});

const toolIcon = computed(() => props.diff.isNewFile ? IconPencil : IconPencilSquare);
const toolName = computed(() => props.diff.isNewFile ? t('diffOverlay.write') : t('diffOverlay.edit'));
</script>

<template>
  <div class="absolute inset-0 z-50 flex flex-col bg-background overflow-hidden">
    <header class="flex items-center gap-3 px-4 py-3 bg-muted border-b border-border/30 shrink-0">
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-foreground hover:bg-background shrink-0"
        @click="emit('close')"
      >
        <IconArrowLeft :size="18" />
      </Button>

      <component :is="toolIcon" :size="20" class="text-primary shrink-0" />

      <div class="flex-1 min-w-0">
        <h2 class="text-sm font-medium text-foreground truncate font-mono">{{ diff.filePath }}</h2>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground leading-none">
          <span>{{ toolName }}</span>
          <span class="text-muted-foreground/50">•</span>
          <span>{{ fileName }}</span>
          <span v-if="diffStats.added > 0" class="text-success">+{{ diffStats.added }}</span>
          <span v-if="diffStats.removed > 0" class="text-error">-{{ diffStats.removed }}</span>
        </div>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto">
      <DiffView
        :old-content="diff.oldContent"
        :new-content="diff.newContent"
        :file-name="diff.filePath"
        :is-new-file="diff.isNewFile"
        :show-header="false"
        max-height="none"
      />
    </div>
  </div>
</template>
