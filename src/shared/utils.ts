/**
 * Strips ASCII control characters from a string, preserving normal whitespace.
 * Removes characters 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, and 0x7F.
 * Preserves tab (0x09), newline (0x0A), and carriage return (0x0D).
 */
export function stripControlChars(str: string): string {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Escapes HTML special characters to prevent XSS when using v-html.
 */
export function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, char => htmlEscapes[char] || char);
}

/**
 * Extracts display text from slash command XML wrappers.
 * Returns the command name with args (e.g., "/task fix the bug") or null if not a command wrapper.
 */
export function extractSlashCommandDisplay(content: string): string | null {
  if (!content.startsWith('<command-')) {
    return null;
  }

  const nameMatch = content.match(/<command-name>([^<]*)<\/command-name>/);
  if (!nameMatch) {
    return null;
  }

  const argsMatch = content.match(/<command-args>([^<]*)<\/command-args>/);
  const commandName = nameMatch[1].trim();
  const commandArgs = argsMatch?.[1]?.trim() || '';

  return commandArgs ? `${commandName} ${commandArgs}` : commandName;
}
