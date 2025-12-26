<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { ScrollArea } from '@/components/ui/scroll-area';
import { IconFile, IconFolder, IconLoader } from '@/components/icons';
import type { WorkspaceFileInfo } from '@shared/types';

const props = defineProps<{
  isOpen: boolean;
  files: WorkspaceFileInfo[];
  selectedIndex: number;
  anchorElement: HTMLElement | null;
  query: string;
  isLoading: boolean;
}>();

const emit = defineEmits<{
  select: [file: WorkspaceFileInfo];
  close: [];
}>();

const popupRef = ref<HTMLDivElement | null>(null);
const itemRefs = ref<(HTMLDivElement | null)[]>([]);
const popupStyle = ref<Record<string, string>>({});

function updatePosition() {
  if (!props.anchorElement) {
    popupStyle.value = {};
    return;
  }

  const rect = props.anchorElement.getBoundingClientRect();

  popupStyle.value = {
    position: 'fixed',
    bottom: `${window.innerHeight - rect.top + 8}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
  };
}

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    updatePosition();
    window.addEventListener('resize', updatePosition);
  } else {
    window.removeEventListener('resize', updatePosition);
  }
}, { immediate: true });

watch(() => props.selectedIndex, (newIndex) => {
  const item = itemRefs.value[newIndex];
  if (item) {
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});

function handleClickOutside(event: MouseEvent) {
  if (popupRef.value && !popupRef.value.contains(event.target as Node)) {
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside);
  window.removeEventListener('resize', updatePosition);
});

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

function getFolderPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, char => htmlEscapes[char] || char);
}

function highlightMatch(text: string): string {
  const escaped = escapeHtml(text);
  if (!props.query) return escaped;

  const lowerText = text.toLowerCase();
  const lowerQuery = props.query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return escaped;

  const escapedBefore = escapeHtml(text.slice(0, index));
  const escapedMatch = escapeHtml(text.slice(index, index + props.query.length));
  const escapedAfter = escapeHtml(text.slice(index + props.query.length));

  return `${escapedBefore}<span class="text-unbound-cyan-300 font-semibold">${escapedMatch}</span>${escapedAfter}`;
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-150 ease-out"
      enter-from-class="opacity-0 scale-95 translate-y-2"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition-all duration-100 ease-in"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 translate-y-2"
    >
      <div
        v-if="isOpen"
        ref="popupRef"
        :style="popupStyle"
        class="z-50 bg-unbound-bg-card border border-unbound-cyan-800/50 rounded-lg shadow-xl overflow-hidden origin-bottom flex flex-col max-h-80"
      >
        <ScrollArea class="flex-1 min-h-0">
          <div class="p-1">
            <!-- Loading State -->
            <div v-if="isLoading" class="px-3 py-4 flex items-center justify-center gap-2 text-sm text-unbound-muted">
              <IconLoader :size="16" class="animate-spin text-unbound-cyan-400" />
              <span>Indexing workspace files...</span>
            </div>

            <!-- Empty State -->
            <div v-else-if="files.length === 0" class="px-3 py-4 text-center text-sm text-unbound-muted">
              <div class="mb-1">No matching files</div>
              <div class="text-xs opacity-70">Try a different search term</div>
            </div>

            <!-- File List -->
            <div
              v-for="(file, index) in files"
              v-else
              :key="file.relativePath"
              :ref="el => itemRefs[index] = el as HTMLDivElement"
              class="px-2 py-1.5 rounded cursor-pointer flex items-center gap-2 transition-all duration-75"
              :class="index === selectedIndex
                ? 'bg-unbound-cyan-900/60 text-unbound-cyan-200'
                : 'hover:bg-unbound-cyan-900/30 text-unbound-text'"
              @click="emit('select', file)"
              @mouseenter="$emit('update:selectedIndex', index)"
            >
              <!-- Icon -->
              <IconFolder v-if="file.isDirectory" :size="16" class="shrink-0 text-unbound-cyan-500" />
              <IconFile v-else :size="16" class="shrink-0 text-unbound-muted" />

              <!-- File info -->
              <div class="flex-1 min-w-0 flex items-center gap-2">
                <!-- Filename (primary) -->
                <span
                  class="font-medium truncate"
                  v-html="highlightMatch(getFileName(file.relativePath))"
                />
                <!-- Folder path (secondary, right-aligned with RTL for smart truncation) -->
                <span
                  v-if="getFolderPath(file.relativePath)"
                  class="text-xs text-unbound-muted/70 truncate flex-1 text-right"
                  style="direction: rtl; text-align: right;"
                >
                  {{ getFolderPath(file.relativePath) }}
                </span>
              </div>
            </div>
          </div>
        </ScrollArea>

        <!-- Footer hints -->
        <div class="px-3 py-2 border-t border-unbound-cyan-900/30 bg-unbound-bg-light/30 text-xs text-unbound-muted flex items-center gap-4">
          <span class="flex items-center gap-1">
            <kbd class="px-1.5 py-0.5 bg-unbound-bg-light rounded text-[10px] font-mono">↑↓</kbd>
            <span class="opacity-80">navigate</span>
          </span>
          <span class="flex items-center gap-1">
            <kbd class="px-1.5 py-0.5 bg-unbound-bg-light rounded text-[10px] font-mono">Tab</kbd>
            <span class="opacity-80">select</span>
          </span>
          <span class="flex items-center gap-1">
            <kbd class="px-1.5 py-0.5 bg-unbound-bg-light rounded text-[10px] font-mono">Esc</kbd>
            <span class="opacity-80">close</span>
          </span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
