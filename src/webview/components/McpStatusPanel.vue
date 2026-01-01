<script setup lang="ts">
import type { McpServerStatusInfo } from '@shared/types';
import type { Component } from 'vue';
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

defineProps<{
  servers: McpServerStatusInfo[];
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refresh'): void;
  (e: 'toggle', serverName: string, enabled: boolean): void;
}>();

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
      return 'Connected';
    case 'failed':
      return 'Failed';
    case 'needs-auth':
      return 'Needs Authentication';
    case 'pending':
      return 'Connecting...';
    case 'idle':
      return 'Ready';
    case 'disabled':
      return 'Disabled';
    default:
      return 'Unknown';
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
</script>

<template>
  <Dialog :open="visible" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent class="bg-card border-border max-w-md max-h-96 overflow-hidden flex flex-col">
      <DialogHeader class="flex flex-row items-center justify-between shrink-0 pr-8">
        <div>
          <DialogTitle>MCP Servers</DialogTitle>
          <DialogDescription class="sr-only">
            View and manage MCP server connections
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
        <div v-if="servers.length === 0" class="text-center py-8 opacity-50">
          <p>No MCP servers configured</p>
          <p class="text-xs mt-2">Add servers in .mcp.json at your workspace root</p>
        </div>

        <div v-else class="space-y-3">
          <Card
            v-for="server in servers"
            :key="server.name"
            class="border-border"
          >
            <CardContent class="p-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <LoadingSpinner v-if="server.status === 'pending'" :size="16" :class="getStatusClass(server.status)" />
                  <component v-else :is="getStatusIcon(server.status)" :size="16" :class="getStatusClass(server.status)" />
                  <span class="font-medium" :class="{ 'opacity-50': !server.enabled }">{{ server.name }}</span>
                </div>
                <div class="flex items-center gap-3">
                  <span
                    class="text-xs px-2 py-0.5 rounded"
                    :class="getStatusClass(server.status)"
                  >
                    {{ getStatusLabel(server.status) }}
                  </span>
                  <Switch
                    :checked="server.enabled"
                    @update:checked="(checked: boolean) => emit('toggle', server.name, checked)"
                  />
                </div>
              </div>

              <div v-if="server.serverInfo" class="mt-2 text-xs opacity-70">
                {{ server.serverInfo.name }} v{{ server.serverInfo.version }}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div class="text-xs text-muted-foreground text-center pt-2 border-t border-border shrink-0">
        MCP servers are loaded from .mcp.json in your workspace
      </div>
    </DialogContent>
  </Dialog>
</template>
