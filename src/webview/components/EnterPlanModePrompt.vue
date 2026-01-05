<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ListboxRoot, ListboxItem, ListboxContent } from 'reka-ui';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'approve', approved: boolean, options?: { customMessage?: string }): void;
}>();

const showCustomInput = ref(false);
const customMessage = ref('');
const selectedValue = ref<string>('yes');
const listboxRef = ref<InstanceType<typeof ListboxRoot> | null>(null);
const textareaRef = ref<{ $el?: HTMLElement } | null>(null);

const options = computed(() => [
  { value: 'yes', label: t('planMode.options.yes'), shortcut: '1' },
  { value: 'no', label: t('planMode.options.no'), shortcut: '2' },
  { value: 'custom', label: t('planMode.options.custom'), shortcut: null },
] as const);

function handleSelect(value: string) {
  switch (value) {
    case 'yes':
      emit('approve', true);
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
    (listboxRef.value?.$el as HTMLElement)?.focus();
  });
}

function resetState() {
  showCustomInput.value = false;
  customMessage.value = '';
  selectedValue.value = 'yes';
}

function handleKeydown(e: KeyboardEvent) {
  if (showCustomInput.value) return;

  const shortcutMap: Record<string, string> = {
    '1': 'yes',
    '2': 'no',
  };

  if (shortcutMap[e.key]) {
    e.preventDefault();
    handleSelect(shortcutMap[e.key]);
  }
}

watch(() => props.visible, (visible) => {
  if (visible) {
    resetState();
    nextTick(() => {
      (listboxRef.value?.$el as HTMLElement)?.focus();
    });
  }
});
</script>

<template>
  <div
    v-if="visible"
    class="border-t border-border bg-background"
    role="region"
    aria-label="Enter plan mode request"
  >
    <!-- Header question -->
    <div class="px-4 py-3 text-sm text-foreground">
      <div class="font-medium">{{ t('planMode.title') }}</div>
      <div class="mt-2 text-muted-foreground text-xs">
        {{ t('planMode.explanation') }}
      </div>
      <div class="mt-2 text-muted-foreground text-xs">
        {{ t('planMode.inPlanMode') }}
        <ul class="list-disc list-inside mt-1 space-y-0.5">
          <li>{{ t('planMode.steps.explore') }}</li>
          <li>{{ t('planMode.steps.patterns') }}</li>
          <li>{{ t('planMode.steps.design') }}</li>
          <li>{{ t('planMode.steps.present') }}</li>
        </ul>
      </div>
      <div class="mt-2 text-muted-foreground text-xs italic">
        {{ t('planMode.disclaimer') }}
      </div>
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
          class="flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer outline-none data-highlighted:bg-primary data-highlighted:text-primary-foreground data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground hover:bg-card"
          :class="option.value === 'custom' ? 'border-t border-border/30 text-muted-foreground' : 'text-foreground'"
          @select="handleSelect(option.value as string)"
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
        class="min-h-20 bg-card border-border resize-none focus:border-primary mb-3"
        :placeholder="t('planMode.customPlaceholder')"
        @keydown.enter.ctrl="handleCustomSubmit"
        @keydown.escape="handleCustomBack"
      />
      <div class="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          @click="handleCustomBack"
        >
          {{ t('common.back') }}
        </Button>
        <Button
          size="sm"
          :disabled="!customMessage.trim()"
          @click="handleCustomSubmit"
        >
          {{ t('permission.sendToClaude') }}
        </Button>
      </div>
    </div>
  </div>
</template>
