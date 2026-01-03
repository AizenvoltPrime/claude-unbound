<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { ListboxRoot, ListboxItem, ListboxContent } from 'reka-ui';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'approve', approved: boolean): void;
}>();

const selectedValue = ref<string>('yes');
const listboxRef = ref<InstanceType<typeof ListboxRoot> | null>(null);

const options = [
  { value: 'yes', label: 'Yes, enter plan mode', shortcut: '1' },
  { value: 'no', label: 'No, start implementing now', shortcut: '2' },
] as const;

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
  }
}

function resetState() {
  selectedValue.value = 'yes';
}

function handleKeydown(e: KeyboardEvent) {
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
      <div class="font-medium">Enter plan mode?</div>
      <div class="mt-2 text-muted-foreground text-xs">
        Claude wants to enter plan mode to explore and design an implementation approach.
      </div>
      <div class="mt-2 text-muted-foreground text-xs">
        In plan mode, Claude will:
        <ul class="list-disc list-inside mt-1 space-y-0.5">
          <li>Explore the codebase thoroughly</li>
          <li>Identify existing patterns</li>
          <li>Design an implementation strategy</li>
          <li>Present a plan for your approval</li>
        </ul>
      </div>
      <div class="mt-2 text-muted-foreground text-xs italic">
        No code changes will be made until you approve the plan.
      </div>
    </div>

    <!-- Options list using Reka UI Listbox -->
    <ListboxRoot
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
          class="flex items-center gap-2 px-4 py-2.5 text-left text-sm text-foreground transition-colors cursor-pointer outline-none data-highlighted:bg-primary data-highlighted:text-primary-foreground data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground hover:bg-card"
          @select="handleSelect(option.value)"
        >
          <span class="font-medium w-4">{{ option.shortcut }}</span>
          <span>{{ option.label }}</span>
        </ListboxItem>
      </ListboxContent>
    </ListboxRoot>
  </div>
</template>
