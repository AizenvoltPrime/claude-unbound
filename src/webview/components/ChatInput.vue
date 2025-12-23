<script setup lang="ts">
import { ref, computed } from 'vue';
import { AVAILABLE_AGENTS, type AgentConfig } from '@shared/types';

const props = defineProps<{
  isProcessing: boolean;
}>();

const emit = defineEmits<{
  send: [content: string, agentId: string];
  cancel: [];
}>();

const inputText = ref('');
const selectedAgent = ref<AgentConfig>(AVAILABLE_AGENTS[0]);
const showAgentPicker = ref(false);

const canSend = computed(() => inputText.value.trim().length > 0 && !props.isProcessing);

function handleSend() {
  if (!canSend.value) return;

  emit('send', inputText.value.trim(), selectedAgent.value.id);
  inputText.value = '';
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
}

function handleCancel() {
  emit('cancel');
}

function selectAgent(agent: AgentConfig) {
  selectedAgent.value = agent;
  showAgentPicker.value = false;
}

function toggleAgentPicker() {
  showAgentPicker.value = !showAgentPicker.value;
}
</script>

<template>
  <div class="border-t border-vscode-border p-3">
    <div class="flex gap-2">
      <textarea
        v-model="inputText"
        :disabled="isProcessing"
        placeholder="Ask Claude anything..."
        class="flex-1 min-h-[60px] max-h-[200px] p-2 rounded border resize-none
               bg-vscode-input-bg text-vscode-input-fg border-vscode-input-border
               focus:outline-none focus:border-vscode-button-bg
               disabled:opacity-50"
        @keydown="handleKeydown"
      />
    </div>

    <div class="flex justify-between items-center mt-2">
      <div class="flex items-center gap-2">
        <!-- Agent picker -->
        <div class="relative">
          <button
            class="flex items-center gap-1 px-2 py-1 text-xs rounded
                   bg-vscode-input-bg border border-vscode-input-border
                   hover:border-vscode-button-bg transition-colors"
            :disabled="isProcessing"
            @click="toggleAgentPicker"
          >
            <span>{{ selectedAgent.icon }}</span>
            <span>{{ selectedAgent.name }}</span>
            <span class="opacity-50">▼</span>
          </button>

          <!-- Dropdown -->
          <div
            v-if="showAgentPicker"
            class="absolute bottom-full left-0 mb-1 w-56 rounded border
                   bg-vscode-dropdown-bg border-vscode-border shadow-lg z-10"
          >
            <button
              v-for="agent in AVAILABLE_AGENTS"
              :key="agent.id"
              class="w-full text-left px-3 py-2 text-xs hover:bg-vscode-list-hoverBackground transition-colors"
              :class="{ 'bg-vscode-list-activeSelectionBackground': agent.id === selectedAgent.id }"
              @click="selectAgent(agent)"
            >
              <div class="flex items-center gap-2">
                <span>{{ agent.icon }}</span>
                <div>
                  <div class="font-medium">{{ agent.name }}</div>
                  <div class="opacity-60">{{ agent.description }}</div>
                </div>
              </div>
            </button>
          </div>
        </div>

        <span class="text-xs text-gray-500">
          Enter to send
        </span>
      </div>

      <div class="flex gap-2">
        <button
          v-if="isProcessing"
          class="px-3 py-1.5 rounded text-sm
                 bg-red-600 text-white hover:bg-red-700
                 transition-colors"
          @click="handleCancel"
        >
          Cancel
        </button>

        <button
          :disabled="!canSend"
          class="px-3 py-1.5 rounded text-sm
                 bg-vscode-button-bg text-vscode-button-fg
                 hover:bg-vscode-button-hover
                 disabled:opacity-50 disabled:cursor-not-allowed
                 transition-colors"
          @click="handleSend"
        >
          {{ isProcessing ? 'Processing...' : 'Send' }}
        </button>
      </div>
    </div>
  </div>
</template>
