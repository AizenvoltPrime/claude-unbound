# Changelog

All notable changes to Claude Unbound will be documented in this file.

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

[1.0.4]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/AizenvoltPrime/claude-unbound/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/AizenvoltPrime/claude-unbound/releases/tag/v1.0.0
