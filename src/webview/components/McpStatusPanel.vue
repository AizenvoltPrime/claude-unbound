<script setup lang="ts">
import type { McpServerStatusInfo } from '@shared/types';
import { Button } from '@/components/ui/button';

defineProps<{
  servers: McpServerStatusInfo[];
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refresh'): void;
}>();

function getStatusIcon(status: McpServerStatusInfo['status']): string {
  switch (status) {
    case 'connected':
      return '✅';
    case 'failed':
      return '❌';
    case 'needs-auth':
      return '🔐';
    case 'pending':
      return '⏳';
    default:
      return '•';
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
    default:
      return 'Unknown';
  }
}

function getStatusClass(status: McpServerStatusInfo['status']): string {
  switch (status) {
    case 'connected':
      return 'text-green-500';
    case 'failed':
      return 'text-red-500';
    case 'needs-auth':
      return 'text-yellow-500';
    case 'pending':
      return 'text-blue-500';
    default:
      return 'text-gray-500';
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
        @click.self="emit('close')"
      >
        <div class="bg-vscode-bg border border-vscode-border rounded-lg shadow-xl max-w-md w-full max-h-96 overflow-hidden">
          <div class="flex items-center justify-between p-4 border-b border-vscode-border">
            <h2 class="font-semibold">MCP Servers</h2>
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                class="h-7"
                @click="emit('refresh')"
              >
                Refresh
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                class="opacity-70 hover:opacity-100"
                @click="emit('close')"
              >
                &times;
              </Button>
            </div>
          </div>

          <div class="p-4 overflow-y-auto max-h-72">
            <div v-if="servers.length === 0" class="text-center py-8 opacity-50">
              <p>No MCP servers configured</p>
              <p class="text-xs mt-2">Add servers in .mcp.json at your workspace root</p>
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="server in servers"
                :key="server.name"
                class="p-3 rounded border border-vscode-border"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span>{{ getStatusIcon(server.status) }}</span>
                    <span class="font-medium">{{ server.name }}</span>
                  </div>
                  <span
                    class="text-xs px-2 py-0.5 rounded"
                    :class="getStatusClass(server.status)"
                  >
                    {{ getStatusLabel(server.status) }}
                  </span>
                </div>

                <div v-if="server.serverInfo" class="mt-2 text-xs opacity-70">
                  {{ server.serverInfo.name }} v{{ server.serverInfo.version }}
                </div>
              </div>
            </div>
          </div>

          <div class="p-3 border-t border-vscode-border text-xs opacity-50 text-center">
            MCP servers are loaded from .mcp.json in your workspace
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
