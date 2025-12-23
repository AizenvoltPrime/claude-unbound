# Claude Unbound ⚡

Unleash the full power of Claude AI as your VS Code coding assistant.

## Features

- **Chat Interface**: Integrated sidebar chat panel for conversing with Claude
- **Code Assistance**: Get help with coding, debugging, refactoring, and more
- **Diff Approval**: Review and approve file changes before they're applied
- **Tool Visualization**: See what tools Claude is using in real-time
- **Streaming Responses**: Watch Claude's responses as they're generated

## Installation

1. Clone the repository
2. Run `npm install`
3. Run `npm run build`
4. Press F5 in VS Code to launch the Extension Development Host

## Usage

- Open the Claude Unbound panel from the activity bar (⚡ icon)
- Type your question or request in the chat input
- Press Enter to send (Shift+Enter for new line)
- Review any file changes in the diff view before approving

### Keyboard Shortcuts

- `Ctrl+Shift+U` / `Cmd+Shift+U`: Focus the chat panel

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `claude-unbound.permissionMode` | How to handle tool permissions (`ask` or `auto`) | `ask` |
| `claude-unbound.maxTurns` | Maximum conversation turns per session | `50` |

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

## License

MIT
