<script setup lang="ts">
import type { PluginStatusInfo } from '@shared/types';
import type { Component } from 'vue';
import { onMounted, onUnmounted } from 'vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  IconCheckCircle,
  IconXCircle,
  IconBan,
  IconPuzzle,
} from '@/components/icons';
import LoadingSpinner from './LoadingSpinner.vue';

const props = defineProps<{
  plugins: PluginStatusInfo[];
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refresh'): void;
  (e: 'toggle', pluginFullId: string, enabled: boolean): void;
}>();

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.visible) {
    e.stopPropagation();
    e.preventDefault();
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});

function getStatusIcon(status: PluginStatusInfo['status']): Component | null {
  switch (status) {
    case 'loaded':
      return IconCheckCircle;
    case 'failed':
      return IconXCircle;
    case 'pending':
      return null;
    case 'disabled':
      return IconBan;
    case 'idle':
      return IconPuzzle;
    default:
      return IconPuzzle;
  }
}

function getStatusLabel(status: PluginStatusInfo['status']): string {
  switch (status) {
    case 'loaded':
      return 'Loaded';
    case 'failed':
      return 'Failed';
    case 'pending':
      return 'Loading...';
    case 'disabled':
      return 'Disabled';
    case 'idle':
      return 'Ready';
    default:
      return 'Unknown';
  }
}

function getStatusClass(status: PluginStatusInfo['status']): string {
  switch (status) {
    case 'loaded':
      return 'text-success';
    case 'failed':
      return 'text-error';
    case 'pending':
      return 'text-primary';
    case 'disabled':
      return 'text-muted-foreground';
    case 'idle':
      return 'text-muted-foreground';
    default:
      return 'text-muted-foreground';
  }
}

function getStatusBadgeClass(status: PluginStatusInfo['status']): string {
  switch (status) {
    case 'loaded':
      return 'bg-success/15 text-success border border-success/30';
    case 'failed':
      return 'bg-error/15 text-error border border-error/30';
    case 'pending':
      return 'bg-primary/15 text-primary border border-primary/30';
    case 'disabled':
      return 'bg-muted text-muted-foreground border border-border';
    case 'idle':
      return 'bg-muted text-muted-foreground border border-border';
    default:
      return 'bg-muted text-muted-foreground border border-border';
  }
}
</script>

<template>
  <Dialog :open="visible" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent class="bg-card border-border max-w-md max-h-96 overflow-hidden flex flex-col">
      <DialogHeader class="flex flex-row items-center justify-between shrink-0 pr-8">
        <div>
          <DialogTitle>Plugins</DialogTitle>
          <DialogDescription class="sr-only">
            View and manage installed plugins
          </DialogDescription>
        </div>
        <Button
          size="sm"
          class="h-7"
          @click="emit('refresh')"
        >
          Refresh
        </Button>
      </DialogHeader>

      <div class="flex-1 overflow-y-auto py-2">
        <div v-if="plugins.length === 0" class="text-center py-8 opacity-50">
          <p>No plugins installed</p>
          <p class="text-xs mt-2">Install plugins via claude plugin add or place in ~/.claude/plugins/</p>
        </div>

        <div v-else class="space-y-2">
          <Card
            v-for="plugin in plugins"
            :key="plugin.fullId"
            class="bg-background border-border hover:bg-background/80 transition-colors"
          >
            <CardContent class="p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <div class="shrink-0">
                    <LoadingSpinner v-if="plugin.status === 'pending'" :size="16" :class="getStatusClass(plugin.status)" />
                    <component v-else :is="getStatusIcon(plugin.status)" :size="16" :class="getStatusClass(plugin.status)" />
                  </div>
                  <span class="font-medium truncate" :class="{ 'opacity-50': !plugin.enabled }">{{ plugin.name }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span
                    class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
                    :class="getStatusBadgeClass(plugin.status)"
                  >
                    {{ getStatusLabel(plugin.status) }}
                  </span>
                  <Switch
                    :checked="plugin.enabled"
                    @update:checked="(checked: boolean) => emit('toggle', plugin.fullId, checked)"
                  />
                </div>
              </div>

              <div v-if="plugin.version || plugin.description" class="mt-2 text-xs text-muted-foreground pl-6">
                <span v-if="plugin.version">v{{ plugin.version }}</span>
                <span v-if="plugin.version && plugin.description"> - </span>
                <span v-if="plugin.description">{{ plugin.description }}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
