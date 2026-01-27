# Problem-Solving Guidelines

## Approach

Ultrathink step-by-step before implementing. For complex problems:

1. First, analyze the problem and identify edge cases
2. Gather requirements through clarifying questions
3. Outline your approach before writing code
4. Implement the solution
5. Review for potential issues

---

## Phase 1: Requirement Gathering

Before implementing any solution, fully understand the user's intent using the **AskUserQuestion tool**.

### When to Ask Questions

Ask clarifying questions when the initial prompt is ambiguous about:

- **Problem/Goal:** What problem does this solve? What's the primary objective?
- **Core Functionality:** What are the key actions or behaviors?
- **Scope/Boundaries:** What should it NOT do? What's out of scope?
- **Target Users:** Who will use this? What are their constraints?
- **Success Criteria:** How do we know it's done correctly?

### How to Ask

Use the AskUserQuestion tool with 2-4 options per question. Structure questions to allow quick selection:

```
Question: "What is the primary goal of this feature?"
Options:
- Improve user onboarding experience
- Increase user retention
- Reduce support burden
```

**Do not assume requirements—when in doubt, ask.**

---

## Phase 2: Planning (For Non-Trivial Tasks)

For features requiring multiple steps, structure your plan with these sections:

### 1. Overview
Brief description of the feature and the problem it solves.

### 2. Goals
Specific, measurable objectives (bullet list).

### 3. User Stories

Each story needs:
- **Title:** Short descriptive name
- **Description:** "As a [user], I want [feature] so that [benefit]"
- **Acceptance Criteria:** Verifiable checklist of what "done" means

Each story should be small enough to implement in one focused session.

**Format:**
```markdown
### US-001: [Title]
**Description:** As a [user], I want [feature] so that [benefit].

**Acceptance Criteria:**
- [ ] Specific verifiable criterion
- [ ] Another criterion
- [ ] Typecheck/lint passes
- [ ] **[UI changes only]** Verify in browser
```

**Important:**
- Acceptance criteria must be verifiable, not vague
- "Works correctly" is bad
- "Button shows confirmation dialog before deleting" is good

### 4. Functional Requirements

Numbered list of specific functionalities:
- "FR-1: The system must allow users to..."
- "FR-2: When a user clicks X, the system must..."

Be explicit and unambiguous.

### 5. Non-Goals (Out of Scope)

What this feature will NOT include. Critical for managing scope.

### 6. Technical Considerations (Optional)

- Known constraints or dependencies
- Integration points with existing systems
- Performance requirements
- Existing components to reuse

### 7. Open Questions

Remaining questions or areas needing clarification before implementation.

---

## Phase 3: Implementation

### Code Quality Standards

**Do:**

- Write self-documenting code with clear, descriptive naming
- Consider and handle edge cases explicitly
- Use concise XML documentation comments for public APIs
- Follow established patterns in the codebase
- Address root causes, not symptoms

**Don't:**

- Use inline comments (code should be self-explanatory)
- Implement bandaid fixes or temporary workarounds
- Add fallback logic that masks underlying issues
- Include backwards compatibility shims
- Over-engineer beyond what's required

---

## Output Format

### For Simple Tasks
Provide:
1. **Brief Analysis**: Key considerations and edge cases identified
2. **Solution**: Clean, production-ready code
3. **Summary**: One-line description of changes made

### For Complex Tasks (Plan Mode)
The plan file should contain:
1. **Overview**: Problem and solution summary
2. **User Stories**: With acceptance criteria
3. **Functional Requirements**: Numbered and unambiguous
4. **Non-Goals**: Clear boundaries
5. **Implementation Order**: Logical sequence of changes

---

## Writing for Clarity

Plans and requirements may be read by junior developers or AI agents. Therefore:

- Be explicit and unambiguous
- Avoid jargon or explain it
- Provide enough detail to understand purpose and core logic
- Number requirements for easy reference
- Use concrete examples where helpful

---

## Problem

$ARGUMENTS
