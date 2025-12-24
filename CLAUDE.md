# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Unbound is a VS Code extension that integrates Claude AI as a coding assistant using the Claude Agent SDK. It provides a webview-based chat interface with features like diff approval, tool visualization, session management, and MCP server support.

## Development Commands

```bash
# Install dependencies
npm install

# Build both extension and webview
npm run build

# Watch mode for development (builds both on change)
npm run dev

# Type checking
npm run typecheck

# Lint
npm run lint

# Build extension only (esbuild)
npm run build:extension

# Build webview only (Vite)
npm run build:webview

# Package for distribution
npm run package
```

**Testing:** Press F5 in VS Code to launch the Extension Development Host.

## Architecture

### Three-Layer Structure

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
│                         Webview (Vue 3)                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  App.vue ─── MessageList, ChatInput, ToolCallCard   │   │
│  │              SettingsPanel, DiffView, etc.          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/extension/ClaudeSession.ts` | Claude Agent SDK integration, message streaming, tool hooks |
| `src/extension/ChatPanelProvider.ts` | Creates/manages webview panels, routes messages |
| `src/extension/PermissionHandler.ts` | Intercepts Edit/Write tools, shows diff for approval |
| `src/shared/types.ts` | All TypeScript types for extension↔webview communication |
| `src/webview/App.vue` | Main webview component, message state management |

### Communication Flow

1. User types in ChatInput → `postMessage({ type: 'sendMessage', content })`
2. ChatPanelProvider receives → calls `ClaudeSession.sendMessage()`
3. ClaudeSession streams SDK responses → converts to `ExtensionToWebviewMessage`
4. Webview receives via `onMessage()` → updates Vue reactive state

### Build Targets

- **Extension:** esbuild bundles `src/extension/` → `dist/extension.js` (CommonJS for Node.js)
- **Webview:** Vite bundles `src/webview/` → `dist/webview/` (ESM for browser)
- SDK is external (not bundled) - listed in `esbuild.config.mjs`

## SDK Integration Notes

ClaudeSession wraps the Agent SDK `query()` function with:

- **Tool permission handling:** `canUseTool` callback routes to PermissionHandler
- **Lifecycle hooks:** `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart/Stop`
- **Streaming:** Handles `stream_event` deltas for thinking/text content
- **Built-in agents:** `code-reviewer`, `explorer`, `planner` defined in `AGENT_DEFINITIONS`

The SDK is dynamically imported (ESM) since the extension uses CommonJS.

## Type Aliases

The codebase uses path aliases configured in both tsconfig.json and vite.config.ts:
- `@shared/*` → `src/shared/*`
- `@/*` → `src/webview/*` (webview only)

## Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Shows diff view for Edit/Write, prompts for other tools |
| `acceptEdits` | Auto-approves Edit/Write, prompts for Bash |
| `bypassPermissions` | Auto-approves all tools |
| `plan` | Read-only mode, no tool execution |

## MCP Server Configuration

MCP servers are loaded from `.mcp.json` in the workspace root and passed to the SDK at session start.

## Session Storage

Sessions are stored in `~/.claude/projects/<encoded-workspace-path>/` as JSONL files. The `SessionStorage.ts` module handles:
- Path encoding for cross-platform compatibility
- Session listing with pagination
- Session renaming (custom-title entries)
- JSONL parsing for history replay
