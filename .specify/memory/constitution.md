<!--
  ============================================================================
  SYNC IMPACT REPORT
  ============================================================================
  Version change: (new) → 1.0.0

  Modified principles: N/A (initial constitution)

  Added sections:
    - Core Principles (5 principles)
    - Architecture Standards
    - Development Workflow
    - Governance

  Removed sections: N/A (initial constitution)

  Templates requiring updates:
    - .specify/templates/plan-template.md: ✅ already aligned (Constitution Check section exists)
    - .specify/templates/spec-template.md: ✅ no changes needed (technology-agnostic)
    - .specify/templates/tasks-template.md: ✅ no changes needed (follows principles)

  Follow-up TODOs: None
  ============================================================================
-->

# Claude Unbound Constitution

## Core Principles

### I. Simplicity First

All code MUST follow the principle of minimal complexity:

- **YAGNI (You Aren't Gonna Need It)**: Only implement what is explicitly required
- **No over-engineering**: Three similar lines of code are better than a premature abstraction
- **No fallback logic**: Silent failures and fallback mechanisms that mask issues are prohibited
- **No feature flags or backwards-compatibility shims**: Change the code directly instead

**Rationale**: Complexity is the primary source of bugs, maintenance burden, and developer confusion. Every abstraction, helper, or utility MUST earn its existence through repeated actual use.

### II. Root Cause Resolution

All fixes and changes MUST address underlying causes:

- **No bandaid fixes**: Temporary fixes or "quick and dirty" solutions are prohibited
- **No symptom treatment**: Investigate and resolve the root cause, not just the visible symptom
- **Proper error handling**: Implement explicit error handling instead of silent failures
- **Design first**: Plan the solution architecture before writing code

**Rationale**: Surface-level fixes create technical debt that compounds over time. Understanding and resolving the root cause prevents recurring issues and improves overall system reliability.

### III. Vertical Architecture

Code organization MUST follow workflow-based patterns:

- **Vertical sliced architecture**: Group related functionality together across all layers (see `claude-session/`, `chat-panel/`, `session/` modules)
- **Data-oriented programming**: Separate data structures from functions that operate on them
- **Locality of behavior**: Keep related code physically close together
- **Dependency injection**: Managers receive dependencies through constructor, wired in facade `index.ts`
- **Functional approach**: Minimize OOP patterns in favor of functional programming

**Rationale**: Vertical slicing makes it easier to understand, modify, and test a single feature without navigating multiple architectural layers. This reduces cognitive load and accelerates development.

### IV. Component-First UI

All webview UI code MUST use the established component library:

- **shadcn-vue components**: Use components from `src/webview/components/ui/` over raw HTML elements
- **Tailwind CSS only**: No custom CSS; use Tailwind utility classes for all styling
- **Lucide icons**: Use wrapper components from `src/webview/components/icons/`
- **VS Code theming**: Respect `unbound-*` color tokens for theme consistency

**Rationale**: Consistent UI components reduce visual bugs, ensure accessibility standards, and maintain theme compatibility. Tailwind's utility-first approach eliminates CSS specificity conflicts.

### V. Self-Documenting Code

Code MUST be readable without explanatory comments:

- **No inline comments**: Code should explain itself through clear naming and structure
- **Documentation comments only for public APIs**: Concise JSDoc/TSDoc for methods, classes, and properties that define public contracts
- **Clear naming conventions**: Variables, functions, and types MUST have descriptive names that reveal intent
- **Small, focused functions**: Functions MUST do one thing and do it well

**Rationale**: Inline comments often become outdated and misleading. Self-documenting code through clear naming and structure ensures the code always reflects its actual behavior.

## Architecture Standards

The Claude Unbound codebase follows these structural patterns:

**Module Organization**:
- Major features are organized as modules in dedicated directories (e.g., `claude-session/`, `chat-panel/`)
- Each module has an `index.ts` facade that wires together internal managers via dependency injection
- Internal managers are named `*-manager.ts` and handle specific concerns

**Type Organization**:
- Shared types live in `src/shared/types/` organized by domain
- Message types use discriminated unions for type-safe communication
- Use `@shared/*` and `@/*` path aliases consistently

**State Management**:
- Webview state is managed through Pinia stores in `src/webview/stores/`
- Each store handles a specific domain (UI, settings, session, permissions, streaming)
- Extension↔Webview communication uses typed `postMessage` with discriminated unions

**Build Targets**:
- Extension code bundles to CommonJS for Node.js runtime
- Webview code bundles to ESM for browser runtime
- SDK is external (not bundled)

## Development Workflow

All contributions MUST follow this process:

**Before Writing Code**:
1. Read existing code in the affected area to understand current patterns
2. Verify the change is necessary and cannot be avoided through simpler means
3. Plan the approach that introduces minimal complexity

**While Writing Code**:
1. Follow existing patterns in the codebase over introducing new ones
2. Make the smallest change that achieves the goal
3. Avoid touching code unrelated to the current task

**Code Review Expectations**:
1. Changes MUST demonstrate necessity (no speculative features)
2. Complexity MUST be justified with concrete current needs
3. Root causes MUST be identified for bug fixes
4. Architecture standards MUST be followed

## Governance

This constitution supersedes all other practices and conventions. All code changes, reviews, and architectural decisions MUST verify compliance with these principles.

**Amendment Process**:
1. Proposed amendments MUST be documented with rationale
2. Amendments require explicit approval and version increment
3. Migration plans MUST accompany breaking changes to governance

**Versioning Policy**:
- MAJOR: Backward incompatible principle removals or redefinitions
- MINOR: New principle/section added or materially expanded guidance
- PATCH: Clarifications, wording, typo fixes, non-semantic refinements

**Compliance Review**:
- All PRs must verify compliance with Core Principles
- Complexity violations require explicit justification in the Complexity Tracking section of plans
- Use `CLAUDE.md` for runtime development guidance and quick reference

**Version**: 1.0.0 | **Ratified**: 2026-01-27 | **Last Amended**: 2026-01-27
