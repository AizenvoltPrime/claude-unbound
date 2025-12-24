<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { ListboxRoot, ListboxItem, ListboxContent } from 'reka-ui';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

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
const selectedValue = ref<string>('yes');
const listboxRef = ref<HTMLElement | null>(null);
const textareaRef = ref<{ $el?: HTMLElement } | null>(null);

const isNewFile = computed(() => !props.originalContent);

const actionLabel = computed(() => {
  if (isNewFile.value) return 'Create this file';
  return 'Make this edit to';
});

const options = [
  { value: 'yes', label: 'Yes', shortcut: '1' },
  { value: 'yes-never-ask', label: 'Yes, and don\'t ask again', shortcut: '2' },
  { value: 'no', label: 'No', shortcut: '3' },
  { value: 'custom', label: 'Tell Claude what to do instead', shortcut: null },
] as const;

function handleSelect(value: string) {
  switch (value) {
    case 'yes':
      emit('approve', true);
      resetState();
      break;
    case 'yes-never-ask':
      emit('approve', true, { neverAskAgain: true });
      resetState();
      break;
    case 'no':
      emit('approve', false);
      resetState();
      break;
    case 'custom':
      showCustomInput.value = true;
      nextTick(() => {
        textareaRef.value?.$el?.focus();
      });
      break;
  }
}

function handleCustomSubmit() {
  if (customMessage.value.trim()) {
    emit('approve', false, { customMessage: customMessage.value.trim() });
    resetState();
  }
}

function handleCustomBack() {
  showCustomInput.value = false;
  customMessage.value = '';
  nextTick(() => {
    listboxRef.value?.focus();
  });
}

function resetState() {
  showCustomInput.value = false;
  customMessage.value = '';
  selectedValue.value = 'yes';
}

// Handle keyboard shortcuts (1, 2, 3) when listbox is focused
function handleKeydown(e: KeyboardEvent) {
  if (showCustomInput.value) return;

  const shortcutMap: Record<string, string> = {
    '1': 'yes',
    '2': 'yes-never-ask',
    '3': 'no',
  };

  if (shortcutMap[e.key]) {
    e.preventDefault();
    handleSelect(shortcutMap[e.key]);
  }
}

// Reset and focus when becoming visible
watch(() => props.visible, (visible) => {
  if (visible) {
    resetState();
    nextTick(() => {
      listboxRef.value?.focus();
    });
  }
});
</script>

<template>
  <div
    v-if="visible"
    class="border-t border-unbound-cyan-800/50 bg-unbound-bg"
    role="region"
    aria-label="Permission request"
  >
    <!-- Header question -->
    <div class="px-4 py-3 text-sm text-unbound-text">
      {{ actionLabel }}
      <span class="text-unbound-muted break-all">{{ filePath }}</span>?
    </div>

    <!-- Options list using Reka UI Listbox -->
    <ListboxRoot
      v-if="!showCustomInput"
      ref="listboxRef"
      v-model="selectedValue"
      class="flex flex-col outline-none"
      orientation="vertical"
      @keydown="handleKeydown"
    >
      <ListboxContent>
        <ListboxItem
          v-for="option in options"
          :key="option.value"
          :value="option.value"
          class="flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer outline-none data-[highlighted]:bg-unbound-cyan-600 data-[highlighted]:text-white data-[state=checked]:bg-unbound-cyan-600 data-[state=checked]:text-white hover:bg-unbound-bg-light"
          :class="option.value === 'custom' ? 'border-t border-unbound-cyan-900/30 text-unbound-muted' : 'text-unbound-text'"
          @select="handleSelect(option.value)"
        >
          <span v-if="option.shortcut" class="font-medium w-4">{{ option.shortcut }}</span>
          <span v-else class="w-4" />
          <span>{{ option.label }}</span>
        </ListboxItem>
      </ListboxContent>
    </ListboxRoot>

    <!-- Custom input mode -->
    <div v-else class="px-4 pb-4">
      <Textarea
        ref="textareaRef"
        v-model="customMessage"
        class="min-h-20 bg-unbound-bg-light border-unbound-cyan-800/50 resize-none focus:border-unbound-cyan-500 mb-3"
        placeholder="e.g., Use a different approach, rename the file, add error handling..."
        @keydown.enter.ctrl="handleCustomSubmit"
        @keydown.escape="handleCustomBack"
      />
      <div class="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          @click="handleCustomBack"
        >
          Back
        </Button>
        <Button
          size="sm"
          :disabled="!customMessage.trim()"
          @click="handleCustomSubmit"
        >
          Send to Claude
        </Button>
      </div>
    </div>
  </div>
</template>
