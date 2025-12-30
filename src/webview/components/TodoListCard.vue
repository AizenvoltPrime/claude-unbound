<script setup lang="ts">
import { computed } from 'vue';
import { IconClipboard, IconCheck, IconCircleYellow, IconCircleGreen } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { IconChevronDown, IconChevronUp } from '@/components/icons';
import type { TodoItem } from '@shared/types';

const props = defineProps<{
  todos: TodoItem[];
  isCollapsed?: boolean;
}>();

const emit = defineEmits<{
  'update:isCollapsed': [value: boolean];
}>();

const completedCount = computed(() =>
  props.todos.filter(t => t.status === 'completed').length
);

const totalCount = computed(() => props.todos.length);

const hasInProgress = computed(() =>
  props.todos.some(t => t.status === 'in_progress')
);

function getStatusIcon(status: TodoItem['status']) {
  switch (status) {
    case 'completed':
      return { icon: IconCheck, class: 'text-success' };
    case 'in_progress':
      return { icon: IconCircleYellow, class: 'text-warning animate-pulse' };
    case 'pending':
    default:
      return { icon: null, class: 'text-muted-foreground' };
  }
}

function getStatusEmoji(status: TodoItem['status']): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'in_progress':
      return '●';
    case 'pending':
    default:
      return '○';
  }
}
</script>

<template>
  <Collapsible
    :open="!isCollapsed"
    @update:open="emit('update:isCollapsed', !$event)"
    class="border border-border rounded-lg bg-card overflow-hidden"
  >
    <CollapsibleTrigger class="w-full px-3 py-2 flex items-center gap-2 bg-foreground/5 hover:bg-foreground/10 transition-colors cursor-pointer">
      <IconClipboard :size="16" class="text-primary" />
      <span class="font-medium text-sm">Current Tasks</span>
      <Badge
        variant="secondary"
        :class="[
          'ml-auto text-xs',
          completedCount === totalCount && totalCount > 0
            ? 'bg-success/30 text-success'
            : hasInProgress
              ? 'bg-warning/30 text-warning'
              : 'bg-primary/30 text-primary'
        ]"
      >
        {{ completedCount }}/{{ totalCount }}
      </Badge>
      <component
        :is="isCollapsed ? IconChevronDown : IconChevronUp"
        :size="14"
        class="text-muted-foreground"
      />
    </CollapsibleTrigger>

    <CollapsibleContent>
      <div class="px-3 pb-2 space-y-1">
        <div
          v-for="(todo, index) in todos"
          :key="index"
          class="flex items-start gap-2 py-1 text-sm"
        >
          <span
            class="mt-0.5 w-4 text-center shrink-0"
            :class="getStatusIcon(todo.status).class"
          >
            {{ getStatusEmoji(todo.status) }}
          </span>
          <span
            :class="[
              'flex-1',
              todo.status === 'completed' && 'line-through opacity-50'
            ]"
          >
            {{ todo.content }}
          </span>
          <Badge
            v-if="todo.status === 'in_progress'"
            variant="outline"
            class="text-[10px] px-1.5 py-0.5 bg-warning/20 text-warning border-warning/30 animate-pulse"
          >
            in progress
          </Badge>
        </div>

        <div
          v-if="todos.length === 0"
          class="text-xs text-muted-foreground text-center py-2"
        >
          No tasks
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
