# VS Code Claude Code Extension - Implementation Plan

## Overview

Build a VS Code extension using the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) to provide an integrated AI coding assistant with chat UI, diff approval, and multi-agent support.

**Authentication**: Uses Claude Agent SDK which internally wraps Claude Code CLI - inherits Max subscription auth automatically.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                        │
├─────────────────────────────────────────────────────────────┤
│  Extension Host (Node.js)          │  Webview (Vue 3)       │
│  ├── ClaudeSession.ts              │  ├── App.vue           │
│  │   └── SDK query() wrapper       │  ├── MessageList.vue   │
│  ├── PermissionHandler.ts          │  ├── ChatInput.vue     │
│  │   └── canUseTool callback       │  ├── ToolCallCard.vue  │
│  ├── DiffManager.ts                │  ├── DiffView.vue      │
│  │   └── Shows VS Code diff        │  └── FileTree.vue      │
│  └── ChatPanelProvider.ts          │                        │
│      └── Webview bridge            │                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Claude Agent SDK     │
              │  query() async gen    │
              │  canUseTool callback  │
              │  hooks system         │
              └───────────────────────┘
```

## Project Structure

```
claude-vscode/
├── src/
│   ├── extension/           # VS Code extension (Node.js)
│   │   ├── extension.ts     # Entry point, activation
│   │   ├── ClaudeSession.ts # SDK query() wrapper + message handling
│   │   ├── PermissionHandler.ts # canUseTool callback implementation
│   │   ├── DiffManager.ts   # VS Code diff for approval flow
│   │   └── ChatPanelProvider.ts
│   ├── webview/             # Vue 3 webview (browser)
│   │   ├── App.vue
│   │   ├── main.ts
│   │   ├── components/
│   │   │   ├── ChatInput.vue
│   │   │   ├── MessageList.vue
│   │   │   ├── ToolCallCard.vue
│   │   │   ├── DiffView.vue
│   │   │   └── FileTree.vue
│   │   └── composables/
│   │       └── useVSCode.ts
│   └── shared/
│       └── types.ts         # Re-export SDK types + extension-specific
├── package.json             # Extension manifest
├── esbuild.config.mjs       # Extension bundler
├── vite.config.ts           # Webview bundler
└── tailwind.config.js
```

## Key Components

### 1. ClaudeSession - SDK Query Wrapper

- Calls `query()` from `@anthropic-ai/claude-agent-sdk`
- Iterates async generator for typed `SDKMessage` events
- Uses `includePartialMessages: true` for streaming
- Manages AbortController for cancellation
- Handles session resume via `resume` option

### 2. PermissionHandler - canUseTool Callback

- Implements SDK's `canUseTool` callback (SDK's built-in permission system)
- Returns `{ behavior: 'allow' | 'deny', updatedInput }`
- For Edit/Write: shows diff, awaits user approval before returning
- No custom interception needed - SDK handles the flow

### 3. DiffManager - VS Code Diff Integration

- Creates temp files with proposed changes
- Opens `vscode.diff` command with original vs proposed
- Returns Promise that resolves when user approves/rejects
- Cleans up temp files after decision

### 4. Vue 3 Webview - Chat Interface

- MessageList.vue: Renders `SDKAssistantMessage` with markdown
- ChatInput.vue: User input with send/cancel (triggers abort)
- ToolCallCard.vue: Visualizes tool calls from message content blocks
- FileTree.vue: Shows files from Read/Edit/Write tool inputs
- Composables: useVSCode() for postMessage API

## Implementation Phases

### Phase 1: Core Infrastructure

- [ ] Initialize VS Code extension project with package.json manifest
- [ ] Set up esbuild (extension) + Vite (webview) dual build system
- [ ] Implement ClaudeSession with SDK `query()` and message iteration
- [ ] Create WebviewView provider with postMessage bridge
- [ ] Minimal Vue 3 UI (ChatInput + MessageList)

### Phase 2: Permission & Diff Workflow

- [ ] Implement PermissionHandler with `canUseTool` callback
- [ ] Create DiffManager using VS Code's `vscode.diff` command
- [ ] Wire up Edit/Write tool approval flow
- [ ] Add ToolCallCard component for visualizing tool uses
- [ ] Handle abort via AbortController

### Phase 3: Streaming & UI Polish

- [ ] Enable `includePartialMessages` for real-time streaming
- [ ] Implement markdown rendering with syntax highlighting
- [ ] Add FileTree component (track Read/Edit/Write files)
- [ ] Show `SDKResultMessage` cost/usage stats

### Phase 4: Multi-Agent & Hooks

- [ ] Use SDK's `agents` option for subagent definitions
- [ ] Add agent picker UI in chat input
- [ ] Implement `PreToolUse` hook for UI feedback
- [ ] Implement `Notification` hook for toast messages

### Phase 5: Session Management & Settings

- [ ] Session resume via `resume` option + `session_id`
- [ ] Load CLAUDE.md via `settingSources: ['project']`
- [ ] Settings UI (model, permissionMode, maxTurns)
- [ ] Keyboard shortcuts (Ctrl+Shift+C to focus chat)
- [ ] Cost tracking from `SDKResultMessage.total_cost_usd`

## SDK Integration

```typescript
import { query, type SDKMessage, type CanUseTool, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// Permission handler for Edit/Write approval
const canUseTool: CanUseTool = async (toolName, input, { signal }) => {
  if (toolName === "Edit" || toolName === "Write") {
    const approved = await diffManager.showDiffAndAwaitApproval(input as FileEditInput | FileWriteInput);
    if (!approved) {
      return { behavior: "deny", message: "User rejected the edit" };
    }
  }
  return { behavior: "allow", updatedInput: input };
};

// Start a query with streaming
const abortController = new AbortController();
const result = query({
  prompt: userMessage,
  options: {
    cwd: workspaceFolder,
    abortController,
    includePartialMessages: true, // Enable streaming
    canUseTool, // Permission handling
    settingSources: ["project"], // Load CLAUDE.md
    systemPrompt: { type: "preset", preset: "claude_code" },
    tools: { type: "preset", preset: "claude_code" },
    hooks: {
      Notification: [{ hooks: [notificationHandler] }],
      PreToolUse: [{ hooks: [toolUseUIHandler] }],
    },
  },
});

// Consume the async generator
for await (const message of result) {
  switch (message.type) {
    case "assistant":
      webview.postMessage({ type: "assistant", data: message });
      break;
    case "stream_event":
      webview.postMessage({ type: "partial", data: message });
      break;
    case "result":
      webview.postMessage({ type: "done", data: message });
      break;
  }
}
```

## Message Protocol (shared/types.ts)

```typescript
// Re-export SDK types for use in webview (serializable subset)
import type { SDKAssistantMessage, SDKResultMessage, SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

// Webview → Extension (user actions)
type WebviewMessage = { type: "sendMessage"; content: string } | { type: "cancelSession" } | { type: "resumeSession"; sessionId: string };

// Extension → Webview (SDK events forwarded)
type ExtensionMessage =
  | { type: "assistant"; data: SDKAssistantMessage }
  | { type: "partial"; data: SDKPartialAssistantMessage }
  | { type: "done"; data: SDKResultMessage }
  | { type: "toolPending"; toolName: string; input: unknown }
  | { type: "error"; message: string };
```

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest"
  },
  "devDependencies": {
    "@types/vscode": "^1.95.0",
    "esbuild": "^0.24.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-vue": "^5.2.0",
    "vue": "^3.5.0",
    "tailwindcss": "^3.4.0",
    "marked": "^15.0.0",
    "highlight.js": "^11.10.0",
    "typescript": "^5.7.0"
  }
}
```

## VS Code Features Used

- **WebviewView**: Chat panel in sidebar
- **vscode.diff**: Native diff editor for approvals
- **TreeDataProvider**: File operations tree view
- **ExtensionContext.secrets**: Future: store custom API keys
- **workspace.fs**: File system access
- **commands**: Keyboard shortcuts, context menus
