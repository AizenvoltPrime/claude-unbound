import type { BuiltinSlashCommandInfo } from './types';

export const BUILTIN_SLASH_COMMANDS: BuiltinSlashCommandInfo[] = [
  // Tier 1: Essential
  { name: 'clear', description: 'Clear conversation history', source: 'builtin' },
  { name: 'compact', description: 'Compact conversation', argumentHint: '[instructions]', source: 'builtin' },
  { name: 'help', description: 'Get usage help', source: 'builtin' },
  { name: 'cost', description: 'Show token usage', source: 'builtin' },
  { name: 'context', description: 'Show context usage', source: 'builtin' },
  // Tier 2: Power User
  { name: 'rewind', description: 'Rewind conversation/code', source: 'builtin' },
  { name: 'export', description: 'Export conversation', argumentHint: '[filename]', source: 'builtin' },
  { name: 'review', description: 'Request code review', source: 'builtin' },
  { name: 'security-review', description: 'Security review of changes', source: 'builtin' },
  { name: 'init', description: 'Initialize CLAUDE.md', source: 'builtin' },
  { name: 'memory', description: 'Edit memory files', source: 'builtin' },
  // Tier 3: Advanced
  { name: 'mcp', description: 'Manage MCP servers', source: 'builtin' },
  { name: 'permissions', description: 'View/update permissions', source: 'builtin' },
  { name: 'output-style', description: 'Set output style', argumentHint: '[style]', source: 'builtin' },
  { name: 'stats', description: 'View usage statistics', source: 'builtin' },
  { name: 'usage', description: 'Show plan usage limits', source: 'builtin' },
];
