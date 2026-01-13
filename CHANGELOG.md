# Changelog

All notable changes to Claude Unbound will be documented in this file.

## [1.0.14] - 2026-01-13

### Fixed

- Fix Shift+Enter not inserting newlines in prompt textareas (AskUserQuestion, permission prompts, skill approvals, plan mode)

## [1.0.13] - 2026-01-13

### Fixed

- Fix MCP servers failing to start on Remote SSH due to NVM/FNM paths not in PATH (VS Code Server doesn't source shell configs)

## [1.0.12] - 2026-01-12

### Fixed

- Fix SDK tools and agent discovery failing on Remote SSH due to ripgrep binary lacking execute permissions
- Revert workaround from 1.0.11 (SDK discovery now works with ripgrep fix)

## [1.0.11] - 2026-01-12

### Fixed

- Fix custom agents from `.claude/agents/` not loading on Remote SSH (bypass SDK filesystem discovery)

## [1.0.10] - 2026-01-10

### Fixed

- Fix provider profile settings unable to save to User Settings (changed scope from "resource" to "window")

## [1.0.9] - 2026-01-10

### Fixed

- Fix extension package including unintended files

## [1.0.8] - 2026-01-10

### Added

- Provider Profiles: Define multiple API provider configurations with custom environment variables
- Switch between providers (Anthropic, Z.AI, OpenRouter, etc.) from the settings panel
- Provider-specific model mapping via ANTHROPIC*DEFAULT*\*\_MODEL environment variables
- Secure credential storage: API keys encrypted via OS keychain (VS Code SecretStorage API), masked input fields in profile editor
- Per-panel provider profiles: Each open panel can have its own provider profile independent of other panels
- Global default profile setting: Configure which profile new panels inherit (separate from per-panel selection)

### Fixed

- Fix streaming text not being captured when assistant message contains non-streamed text content
- Fix concurrent streaming with different provider profiles causing race conditions
- Fix loose model tier matching to use explicit Claude model prefixes
- Add environment variable key validation in profile editor

### Changed

- Extended thinking now inherits SDK default when not explicitly configured (instead of forcing a value)

## [1.0.7] - 2026-01-10

### Fixed

- Fix memory leak when closing panel
- Call `reset()` instead of `cancel()` on panel dispose for proper SDK cleanup
- Clean up pending permission promises on dispose to prevent dangling references
- Add error resilience to PermissionHandler cleanup loops

## [1.0.6] - 2026-01-08

### Fixed

- Fix MCP server/plugin toggle failing when `settings.local.json` doesn't exist
- Fix settings path resolution to properly fall back from project to user settings
- Add error notifications when settings fail to save (MCP, plugins, thinking tokens, budget)

### Changed

- Default thinking tokens now 63999 (extended thinking enabled by default)

## [1.0.5] - 2026-01-08

### Added

- Skills can now be invoked directly via slash commands (`/skill-name`)
- Skills appear in slash command autocomplete alongside regular commands
- Skills invoked via slash command are auto-approved (no approval prompt needed)
- Plugin skills support with format `/plugin:skill-name`

## [1.0.4] - 2026-01-06

### Added

- Add "Open in Editor" button to plan view header

### Fixed

- Fix ESC incorrectly restoring prompt to ChatInput when streaming had already started
- Fix diff view ENOENT errors when temp directory was cleaned by OS

### Changed

- Refactor DiffManager to use VS Code virtual documents instead of temp files

## [1.0.3] - 2026-01-06

### Fixed

- Fix maxTurns default value in documentation (50 → 100)
- Remove outdated /context command reference

## [1.0.2] - 2026-01-05

### Fixed

- Remove empty "Unreleased" section from changelog

## [1.0.1] - 2026-01-05

### Fixed

- Include CHANGELOG.md in extension package

## [1.0.0] - 2026-01-05

### Added

- Initial release
- Chat interface with streaming responses
- Diff approval for file changes with syntax highlighting
- Tool visualization with real-time status
- Subagent visualization with nested view
- @ mentions for workspace files and agents
- Custom agents support from `.claude/agents/`
- Image attachments via clipboard paste
- IDE context injection (active file/selection)
- Slash commands with autocomplete
- Command history navigation (shell-style)
- Session management (create, rename, resume, delete)
- Panel persistence across VS Code restarts
- Multi-panel synchronization
- Context stats (tokens, cache, cost)
- Model selection (Opus, Sonnet, Haiku)
- Extended thinking mode with adjustable budget
- Per-panel permission modes
- Plan mode for implementation review
- File checkpointing and rewind
- Todo list visualization
- Message queue for tool boundary injection
- MCP server management
- Hooks and plugins support
- Skills approval workflow
- Localization (English, Greek)

[1.0.14]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.13...v1.0.14
[1.0.13]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/AizenvoltPrime/claude-unbound/releases/tag/v1.0.0
