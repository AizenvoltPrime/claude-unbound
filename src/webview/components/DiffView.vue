<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '@/components/ui/button';

const props = defineProps<{
  original: string;
  proposed: string;
  fileName: string;
}>();

const emit = defineEmits<{
  approve: [];
  reject: [];
}>();

const lines = computed(() => {
  const originalLines = props.original.split('\n');
  const proposedLines = props.proposed.split('\n');

  const result: Array<{
    type: 'unchanged' | 'removed' | 'added';
    content: string;
    lineNum?: number;
  }> = [];

  // Simple diff - show removed then added
  const maxLen = Math.max(originalLines.length, proposedLines.length);

  for (let i = 0; i < maxLen; i++) {
    const orig = originalLines[i];
    const prop = proposedLines[i];

    if (orig === prop) {
      result.push({ type: 'unchanged', content: orig ?? '', lineNum: i + 1 });
    } else {
      if (orig !== undefined) {
        result.push({ type: 'removed', content: orig, lineNum: i + 1 });
      }
      if (prop !== undefined) {
        result.push({ type: 'added', content: prop, lineNum: i + 1 });
      }
    }
  }

  return result;
});
</script>

<template>
  <div class="border border-vscode-border rounded overflow-hidden">
    <div class="bg-vscode-input-bg px-3 py-2 border-b border-vscode-border flex justify-between items-center">
      <span class="font-medium text-sm">{{ fileName }}</span>
      <div class="flex gap-2">
        <Button variant="destructive" size="sm" @click="emit('reject')">
          Reject
        </Button>
        <Button size="sm" class="bg-green-600 hover:bg-green-700" @click="emit('approve')">
          Approve
        </Button>
      </div>
    </div>

    <div class="overflow-x-auto max-h-[400px] overflow-y-auto">
      <pre class="text-xs leading-relaxed m-0 p-0"><code><template
        v-for="(line, idx) in lines"
        :key="idx"
><div
  :class="[
    'px-3 py-0.5',
    line.type === 'removed' ? 'bg-red-900/30 text-red-300' : '',
    line.type === 'added' ? 'bg-green-900/30 text-green-300' : '',
  ]"
><span class="opacity-50 mr-3 select-none w-8 inline-block text-right">{{ line.lineNum }}</span><span
  :class="line.type === 'removed' ? 'line-through' : ''"
>{{ line.type === 'removed' ? '- ' : line.type === 'added' ? '+ ' : '  ' }}{{ line.content }}</span></div></template></code></pre>
    </div>
  </div>
</template>
