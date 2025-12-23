I'm working on a VS Code extension called "Claude Unbound" that provides a chat interface to Claude AI. I need to fix two bugs visible in the attached screenshot:

## Bug 1: API Response Error
**Symptom**: When a user sends a message (e.g., "what day is it"), Claude responds with:
`Error: The "path" argument must be of type string or an instance of URL. Received undefined`

**Expected behavior**: Claude should respond with the actual answer to the user's question.

**Investigation needed**:
1. First, identify where this error originates in the codebase (likely in the API call or message handling logic)
2. Find where a path/URL parameter is being passed as undefined
3. Implement the fix with proper null checking or correct parameter passing

## Bug 2: Transparent Dropdown Menu
**Symptom**: The agent selection dropdown at the bottom (showing Default, Code Reviewer, Explorer, Planner) has a semi-transparent background, making text hard to read against the chat content behind it.

**Expected behavior**: The dropdown should have an opaque background matching the VS Code theme.

**Investigation needed**:
1. Find the CSS/styling for this dropdown component
2. Add proper background-color and ensure it's not inheriting unwanted transparency

---

Please investigate each bug separately, identify the root cause, then implement minimal fixes. Show me the relevant code files and explain what caused each issue before making changes.
