<script setup lang="ts">
import type { McpServerStatusInfo } from '@shared/types/mcp';
import type { Component } from 'vue';
import { onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
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
  IconKey,
  IconGear,
  IconBan,
} from '@/components/icons';
import LoadingSpinner from './LoadingSpinner.vue';

const { t } = useI18n();

const props = defineProps<{
  servers: McpServerStatusInfo[];
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refresh'): void;
  (e: 'toggle', serverName: string, enabled: boolean): void;
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

function getStatusIcon(status: McpServerStatusInfo['status']): Component | null {
  switch (status) {
    case 'connected':
      return IconCheckCircle;
    case 'failed':
      return IconXCircle;
    case 'needs-auth':
      return IconKey;
    case 'pending':
      return null;
    case 'idle':
      return IconGear;
    case 'disabled':
      return IconBan;
    default:
      return IconGear;
  }
}

function getStatusLabel(status: McpServerStatusInfo['status']): string {
  switch (status) {
    case 'connected':
      return t('mcp.connected');
    case 'failed':
      return t('mcp.failed');
    case 'needs-auth':
      return t('mcp.needsAuth');
    case 'pending':
      return t('mcp.pending');
    case 'idle':
      return t('mcp.ready');
    case 'disabled':
      return t('mcp.disabled');
    default:
      return t('mcp.unknown');
  }
}

function getStatusClass(status: McpServerStatusInfo['status']): string {
  switch (status) {
    case 'connected':
      return 'text-success';
    case 'failed':
      return 'text-error';
    case 'needs-auth':
      return 'text-warning';
    case 'pending':
      return 'text-primary';
    case 'idle':
      return 'text-muted-foreground';
    case 'disabled':
      return 'text-muted-foreground';
    default:
      return 'text-muted-foreground';
  }
}

function getStatusBadgeClass(status: McpServerStatusInfo['status']): string {
  switch (status) {
    case 'connected':
      return 'bg-success/15 text-success border border-success/30';
    case 'failed':
      return 'bg-error/15 text-error border border-error/30';
    case 'needs-auth':
      return 'bg-warning/15 text-warning border border-warning/30';
    case 'pending':
      return 'bg-primary/15 text-primary border border-primary/30';
    case 'idle':
      return 'bg-muted text-muted-foreground border border-border';
    case 'disabled':
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
          <DialogTitle>{{ t('mcp.title') }}</DialogTitle>
          <DialogDescription class="sr-only">
            {{ t('mcp.description') }}
          </DialogDescription>
        </div>
        <Button
          size="sm"
          class="h-7"
          @click="emit('refresh')"
        >
          {{ t('mcp.refresh') }}
        </Button>
      </DialogHeader>

      <div class="flex-1 overflow-y-auto py-2">
        <div v-if="servers.length === 0" class="text-center py-8 opacity-50">
          <p>{{ t('mcp.noServers') }}</p>
          <p class="text-xs mt-2">{{ t('mcp.addServers') }}</p>
        </div>

        <div v-else class="space-y-2">
          <Card
            v-for="server in servers"
            :key="server.name"
            class="bg-background border-border hover:bg-background/80 transition-colors"
          >
            <CardContent class="p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <div class="shrink-0">
                    <LoadingSpinner v-if="server.status === 'pending'" :size="16" :class="getStatusClass(server.status)" />
                    <component v-else :is="getStatusIcon(server.status)" :size="16" :class="getStatusClass(server.status)" />
                  </div>
                  <span class="font-medium truncate" :class="{ 'opacity-50': !server.enabled }">{{ server.name }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span
                    class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
                    :class="getStatusBadgeClass(server.status)"
                  >
                    {{ getStatusLabel(server.status) }}
                  </span>
                  <Switch
                    :checked="server.enabled"
                    @update:checked="(checked: boolean) => emit('toggle', server.name, checked)"
                  />
                </div>
              </div>

              <div v-if="server.serverInfo" class="mt-2 text-xs text-muted-foreground pl-6">
                {{ server.serverInfo.name }} v{{ server.serverInfo.version }}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
