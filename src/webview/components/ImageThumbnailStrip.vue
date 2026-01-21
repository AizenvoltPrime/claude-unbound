<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ImageAttachment } from '@/composables/useImageAttachments';
import { IconX } from '@/components/icons';
import ImageLightbox from './ImageLightbox.vue';

const { t } = useI18n();

defineProps<{
  attachments: ImageAttachment[];
}>();

defineEmits<{
  remove: [id: string];
}>();

const lightboxImageUrl = ref<string | null>(null);

function openLightbox(attachment: ImageAttachment): void {
  lightboxImageUrl.value = attachment.dataUrl;
}

function closeLightbox(): void {
  lightboxImageUrl.value = null;
}
</script>

<template>
  <div
    v-if="attachments.length > 0"
    class="flex gap-2 p-2 overflow-x-auto border-t border-border/50"
  >
    <div
      v-for="attachment in attachments"
      :key="attachment.id"
      class="relative group shrink-0"
    >
      <img
        :src="attachment.dataUrl"
        :alt="attachment.fileName || t('imageThumbnail.attachedImage')"
        class="w-16 h-16 object-cover rounded-md border border-border cursor-pointer hover:opacity-80 transition-opacity"
        :title="t('imageThumbnail.clickToPreview')"
        @click="openLightbox(attachment)"
      />
      <button
        class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground
               flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity
               hover:bg-destructive/80 cursor-pointer"
        :title="t('imageThumbnail.remove', { name: attachment.fileName || 'image' })"
        @click="$emit('remove', attachment.id)"
      >
        <IconX :size="12" />
      </button>
    </div>

    <ImageLightbox
      :open="lightboxImageUrl !== null"
      :image-url="lightboxImageUrl ?? ''"
      @close="closeLightbox"
    />
  </div>
</template>
