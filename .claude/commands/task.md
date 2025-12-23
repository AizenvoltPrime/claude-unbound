# Problem-Solving Guidelines

## Approach

Ultrathink step-by-step before implementing. For complex problems:

1. First, analyze the problem and identify edge cases
2. **Use LSP tools** for semantic code analysis (findReferences, goToImplementation, incomingCalls/outgoingCalls)
3. Outline your approach before writing code
4. Implement the solution
5. Review for potential issues

## Requirement Gathering

Before implementing any solution, use the AskUserQuestion tool to fully understand the user's intent:

1. Ask clarifying questions about requirements, constraints, and expected behavior
2. Confirm your understanding of edge cases and priorities
3. Only proceed to implementation once you have sufficient context

Do not assume requirements—when in doubt, ask.

## Code Quality Standards

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

## Output Format

Provide:

1. **Brief Analysis**: Key considerations and edge cases identified
2. **Solution**: Clean, production-ready code
3. **Summary**: One-line description of changes made

---

## Problem

$ARGUMENTS
