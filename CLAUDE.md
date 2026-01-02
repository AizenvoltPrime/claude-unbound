# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Unbound is a VS Code extension that integrates Claude AI as a coding assistant using the Claude Agent SDK. It provides a webview-based chat interface with features like diff approval, tool visualization, session management, and MCP server support.

## Development Commands

```bash
npm install           # Install dependencies
npm run build         # Build both extension and webview
npm run dev           # Watch mode for development
npm run typecheck     # Type checking
npm run lint          # Lint
npm run package       # Package for distribution
```

**Testing:** Press F5 in VS Code to launch the Extension Development Host.

## Architecture

### Extension ↔ Webview Communication

```
┌─────────────────────────────────────────────────────────────┐
│                      Extension Host (Node.js)               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ ClaudeSession │──│PermissionHdlr│──│  ChatPanelProvider│  │
│  │ (SDK wrapper) │  │(tool approval)│  │ (webview manager) │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│           │                                    │            │
│           │              postMessage           │            │
├───────────┼────────────────────────────────────┼────────────┤
│           ▼                                    ▼            │
│                      Webview (Vue 3 + Pinia)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  App.vue ─── Pinia Stores ─── Components            │   │
│  │  useMessageHandler (composable) handles all events  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Extension Files

| File                                   | Purpose                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `src/extension/claude-session/`        | Claude Agent SDK integration (see module breakdown below) |
| `src/extension/chat-panel/`            | Webview panel management (see module breakdown below)     |
| `src/extension/PermissionHandler.ts`   | Intercepts Edit/Write tools, shows diff for approval      |
| `src/extension/DiffManager.ts`         | Manages concurrent diff views for file changes            |
| `src/extension/SlashCommandService.ts` | Discovers and executes custom slash commands              |
| `src/extension/ripgrep.ts`             | Fast workspace file listing for @ mention autocomplete    |
| `src/extension/session/`               | Session persistence module (see Session Storage below)    |
| `src/shared/types.ts`                  | All TypeScript types for extension↔webview communication  |

### ClaudeSession Module (`claude-session/`)

The SDK integration is modularized into focused managers wired together via dependency injection:

| File                    | Responsibility                                                   |
| ----------------------- | ---------------------------------------------------------------- |
| `index.ts`              | Thin facade exposing public API, wires managers together         |
| `query-manager.ts`      | SDK lifecycle, streaming query creation, model/permission config |
| `streaming-manager.ts`  | Message processing, content accumulation, turn management        |
| `tool-manager.ts`       | Permission handling, tool use correlation, result tracking       |
| `checkpoint-manager.ts` | File checkpointing, rewind operations, cost tracking             |
| `types.ts`              | Interfaces, agent definitions (`AGENT_DEFINITIONS`)              |
| `utils.ts`              | Shared utility functions                                         |

### ChatPanel Module (`chat-panel/`)

The webview panel management is modularized into focused managers:

| File                     | Responsibility                                                       |
| ------------------------ | -------------------------------------------------------------------- |
| `index.ts`               | Public facade (ChatPanelProvider), wires managers together           |
| `panel-manager.ts`       | Webview panel lifecycle, HTML generation, resource URIs              |
| `message-router.ts`      | Handles all webview↔extension message routing                        |
| `session-manager.ts`     | ClaudeSession lifecycle, coordinates with claude-session module      |
| `settings-manager.ts`    | Model/thinking/permission settings, MCP server management            |
| `history-manager.ts`     | Session list, history pagination, session CRUD operations            |
| `storage-manager.ts`     | Checkpoint persistence, rewind operations                            |
| `workspace-manager.ts`   | File indexing for @ mentions, workspace queries                      |
| `ide-context-manager.ts` | Active editor tracking, selection context injection                  |
| `queue-manager.ts`       | Message queuing while Claude is processing (tool boundary injection) |
| `types.ts`               | Internal interfaces for manager communication                        |

### Webview State (Pinia Stores)

| Store                | Responsibility                                                 |
| -------------------- | -------------------------------------------------------------- |
| `useUIStore`         | Panel visibility, processing state, scroll position            |
| `useSettingsStore`   | Model selection, thinking tokens, permission mode, MCP servers |
| `useSessionStore`    | Session list, history pagination, checkpoints, stats           |
| `usePermissionStore` | Pending tool approvals queue                                   |
| `useStreamingStore`  | Messages array, streaming message, tool status                 |
| `useSubagentStore`   | Subagent instances and their streaming states                  |
| `useQuestionStore`   | AskUserQuestion tool responses                                 |

### Communication Flow

1. User types in ChatInput → `postMessage({ type: 'sendMessage', content })`
2. ChatPanelProvider receives → calls `ClaudeSession.sendMessage()`
3. ClaudeSession streams SDK responses → converts to `ExtensionToWebviewMessage`
4. `useMessageHandler` composable dispatches to appropriate Pinia stores

### Build Targets

- **Extension:** esbuild bundles `src/extension/` → `dist/extension.js` (CommonJS for Node.js)
- **Webview:** Vite bundles `src/webview/` → `dist/webview/` (ESM for browser)
- SDK is external (not bundled) - listed in `esbuild.config.mjs`

## SDK Integration

ClaudeSession wraps the Agent SDK `query()` function with:

- **Tool permission handling:** `canUseTool` callback routes to PermissionHandler
- **Lifecycle hooks:** `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart/Stop`
- **Streaming:** Handles `stream_event` deltas for thinking/text content
- **Built-in agents:** `code-reviewer`, `explorer`, `planner` defined in `AGENT_DEFINITIONS`

The SDK is dynamically imported (ESM) since the extension uses CommonJS.

## Webview UI

- **Component Library:** shadcn-vue (radix-vue based) in `src/webview/components/ui/`
- **Styling:** Tailwind CSS with custom `unbound-*` color tokens
- **Icons:** Lucide icons via wrapper components in `src/webview/components/icons/`
- **Code Highlighting:** Shiki with VS Code themes

## Type Aliases

Configured in both tsconfig.json and vite.config.ts:

- `@shared/*` → `src/shared/*`
- `@/*` → `src/webview/*` (webview only)

## Permission Modes

| Mode                | Behavior                                                |
| ------------------- | ------------------------------------------------------- |
| `default`           | Shows diff view for Edit/Write, prompts for other tools |
| `acceptEdits`       | Auto-approves Edit/Write, prompts for Bash              |
| `bypassPermissions` | Auto-approves all tools                                 |
| `plan`              | Read-only mode, no tool execution                       |

## Session Storage

Sessions are stored in `~/.claude/projects/<encoded-workspace-path>/` as JSONL files. The `session/` module handles persistence:

| File          | Responsibility                                        |
| ------------- | ----------------------------------------------------- |
| `paths.ts`    | Path encoding, session directory resolution           |
| `types.ts`    | JSONL entry types, session interfaces                 |
| `reading.ts`  | List sessions, read entries, extract stats            |
| `writing.ts`  | Initialize sessions, persist messages, rename/delete  |
| `branches.ts` | Active branch resolution (handles conversation forks) |
| `history.ts`  | Command history extraction for up/down navigation     |
| `parsing.ts`  | Parse content blocks from JSONL entries               |

## Code Quality Standards

- Never implement fallback business logic, backwards compatibility, or bandaid fixes
- Address root causes rather than symptoms
- Write self-documenting code; avoid inline comments
- Use concise documentation comments for public APIs only
- Prefer functional patterns over OOP
- Use Tailwind instead of custom CSS

### Architectural Patterns

- **Vertical Sliced Architecture**: Group related functionality together (e.g., `claude-session/`, `chat-panel/`, `session/`)
- **Data-oriented Programming**: Separate data structures from functions that operate on them
- **Locality of Behavior**: Keep related code physically close together
- **Dependency Injection**: Managers receive dependencies through constructor, wired in facade `index.ts`
