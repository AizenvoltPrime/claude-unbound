<div align="center">
  <img src="resources/icon.png" alt="Claude Unbound" width="128">
  <h1>Claude Unbound</h1>
  <p>Unleash the full power of Claude AI as your VS Code coding assistant.</p>
</div>

## Features

- **Chat Interface**: Integrated sidebar chat panel for conversing with Claude
- **Code Assistance**: Get help with coding, debugging, refactoring, and more
- **Diff Approval**: Review and approve file changes before they're applied
- **Tool Visualization**: See what tools Claude is using in real-time
- **Streaming Responses**: Watch Claude's responses as they're generated
- **Command History**: Navigate previous prompts with arrow keys (shell-style)
- **Session History**: Real-time updates to the session history dropdown when new sessions are created
- **Multi-Panel Sync**: Command history syncs across all open panels instantly
- **Context Stats**: Live tracking of token usage, cache activity, context window %, and session cost
- **Session Logs**: Quick access button to open the raw JSONL session file
- **Model Selection**: Switch between Opus 4.5, Sonnet 4.5, and Haiku 4.5
- **Extended Thinking**: Toggle thinking mode on/off with adjustable token budget (1K-64K)

## Installation

1. Clone the repository
2. Run `npm install`
3. Run `npm run build`
4. Press F5 in VS Code to launch the Extension Development Host

## Usage

- Click the Claude Unbound icon in the editor title bar (top right)
- Type your question or request in the chat input
- Press Enter to send (Shift+Enter for new line)
- Review any file changes in the diff view before approving

### Keyboard Shortcuts

- `Ctrl+Shift+U` / `Cmd+Shift+U`: Focus the chat panel
- `↑` / `↓`: Navigate through command history (like terminal shell)
- `Escape`: Cancel current request (when processing)

## Configuration

| Setting                         | Description                                                                            | Default   |
| ------------------------------- | -------------------------------------------------------------------------------------- | --------- |
| `claude-unbound.permissionMode` | How to handle tool permissions (`default`, `acceptEdits`, `bypassPermissions`, `plan`) | `default` |
| `claude-unbound.maxTurns`       | Maximum conversation turns per session                                                 | `50`      |

## Requirements

- VS Code 1.95.0 or higher
- Claude Max subscription (authentication via Claude Code CLI)

## Development

```bash
# Install dependencies
npm install

# Build extension and webview
npm run build

# Watch mode for development
npm run dev

# Type check
npm run typecheck
```

## Architecture

- **Extension Host** (Node.js): Handles Claude Agent SDK integration
- **Webview** (Vue 3 + Tailwind): Chat interface
- **postMessage Bridge**: Communication between extension and webview
