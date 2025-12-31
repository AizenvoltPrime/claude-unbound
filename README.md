<div align="center">
  <img src="resources/icon.png" alt="Claude Unbound" width="128">
  <h1>Claude Unbound</h1>
  <p>Unleash the full power of Claude AI as your VS Code coding assistant.</p>
</div>

## Features

- **Chat Interface**: Integrated sidebar chat panel for conversing with Claude
- **Code Assistance**: Get help with coding, debugging, refactoring, and more
- **Syntax Highlighting**: Shiki-powered code blocks with VS Code-quality highlighting and one-click copy
- **Diff Approval**: Review and approve file changes with syntax-highlighted unified diffs (supports concurrent diffs)
- **Tool Visualization**: See what tools Claude is using in real-time with expandable details
- **Subagent Visualization**: Nested view of Task tool calls showing agent type, model, tool calls, and results
- **Streaming Responses**: Watch Claude's responses as they're generated
- **@ Mentions**: Type `@` to reference workspace files with fuzzy search autocomplete
- **Slash Commands**: Type `/` for built-in commands (`/clear`, `/compact`, `/rewind`, etc.) and custom commands from `.claude/commands/`
- **Command History**: Navigate previous prompts with arrow keys (shell-style)
- **Session Management**: Create, rename, resume, and delete sessions with confirmation
- **Multi-Panel Sync**: Command history syncs across all open panels instantly
- **Context Stats**: Live tracking of token usage, cache activity, context window %, and session cost
- **Context Usage Panel**: Detailed breakdown of context window usage by category (`/context`)
- **Session Logs**: Quick access button to open the raw JSONL session file (also works for subagent logs)
- **Model Selection**: Switch between Opus 4.5, Sonnet 4.5, and Haiku 4.5
- **Extended Thinking**: Toggle thinking mode on/off with adjustable token budget (1K-64K)
- **Per-Panel Permission Mode**: Each panel can have its own permission mode independent of the global default
- **File Checkpointing**: Track file changes and rewind to any previous state with the Rewind Browser (`/rewind`)
- **Todo List**: Visual display of Claude's current task list with real-time progress tracking
- **Message Queue**: Send messages while Claude is working - they're injected at the next tool boundary

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

#### @ Mention Autocomplete

- `@`: Trigger file autocomplete popup
- `↑` / `↓`: Navigate suggestions
- `Tab` / `Enter`: Insert selected file
- `Escape`: Close popup

#### Slash Command Autocomplete

- `/`: Trigger command autocomplete popup
- `↑` / `↓`: Navigate suggestions
- `Tab` / `Enter`: Insert selected command
- `Escape`: Close popup

**Built-in commands:**

| Command             | Description                        |
| ------------------- | ---------------------------------- |
| `/clear`            | Clear conversation history         |
| `/compact`          | Compact conversation               |
| `/context`          | Show context usage breakdown       |
| `/cost`             | Show token usage and cost          |
| `/rewind`           | Rewind conversation/code to a checkpoint |
| `/export`           | Export conversation to file        |
| `/review`           | Request code review                |
| `/security-review`  | Security review of changes         |
| `/init`             | Initialize CLAUDE.md               |
| `/memory`           | Edit memory files                  |
| `/mcp`              | Manage MCP servers                 |
| `/permissions`      | View/update permissions            |
| `/help`             | Get usage help                     |

Custom commands are loaded from `.claude/commands/*.md` (project) and `~/.claude/commands/*.md` (user).

## Configuration

| Setting                          | Description                                                                            | Default   |
| -------------------------------- | -------------------------------------------------------------------------------------- | --------- |
| `claude-unbound.permissionMode`  | How to handle tool permissions (`default`, `acceptEdits`, `bypassPermissions`, `plan`) | `default` |
| `claude-unbound.maxTurns`        | Maximum conversation turns per session                                                 | `50`      |
| `claude-unbound.maxIndexedFiles` | Maximum files to index for @ mention autocomplete                                      | `5000`    |

## Requirements

- VS Code 1.95.0 or higher
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)
- `ANTHROPIC_API_KEY` environment variable set (see Authentication below)

## Authentication

Claude Unbound uses the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/typescript), which uses Claude Code as its runtime. **The extension does not handle authentication directly** — it delegates entirely to Claude Code.

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│  Claude Unbound Extension                               │
│         │                                               │
│         ▼                                               │
│  @anthropic-ai/claude-agent-sdk                         │
│         │                                               │
│         ▼ (uses as runtime)                             │
│  Claude Code                                            │
│         │                                               │
│         ▼ (handles authentication)                      │
│  Anthropic API                                          │
└─────────────────────────────────────────────────────────┘
```

The SDK uses Claude Code as its runtime. This means:

- All Claude Code authentication methods work automatically
- Sessions persist in `~/.claude/projects/`
- Tool execution, sandboxing, and permissions are handled by Claude Code

### Why Claude Code CLI Is Required

The Claude Agent SDK uses Claude Code as its runtime — it's not a standalone API client. Claude Code provides:

- **Built-in tools** — Bash, Read, Write, Edit, Grep, Glob, etc.
- **Authentication** — OAuth session management, API keys, cloud provider credentials
- **Session persistence** — Conversation history stored in `~/.claude/projects/`
- **Sandboxing** — OS-level process isolation for safe command execution
- **Permissions** — Tool approval workflows and permission modes

Your extension calls the SDK API; the SDK handles everything else through Claude Code.

### Setting Up Authentication

**Option 1: API Key (Recommended)**

```bash
export ANTHROPIC_API_KEY=your-api-key
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/). This is the officially recommended authentication method for SDK-based applications.

**Option 2: Cloud Providers**

For enterprise environments using cloud-hosted Claude:

| Variable | Purpose |
|----------|---------|
| `CLAUDE_CODE_USE_BEDROCK=1` | Use AWS Bedrock (requires AWS credentials) |
| `CLAUDE_CODE_USE_VERTEX=1` | Use Google Vertex AI (requires GCP credentials) |
| `CLAUDE_CODE_USE_FOUNDRY=1` | Use Microsoft Foundry (requires Azure credentials) |

### Verifying Authentication

Once authenticated, the extension displays your account info (email, subscription type) in the chat panel header.

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
