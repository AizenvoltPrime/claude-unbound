import type { BuiltinSlashCommandInfo } from './types';

export const BUILTIN_SLASH_COMMANDS: BuiltinSlashCommandInfo[] = [
  { name: 'clear', description: 'Clear conversation history', source: 'builtin' },
  { name: 'compact', description: 'Compact conversation', argumentHint: '[instructions]', source: 'builtin' },
  { name: 'rewind', description: 'Rewind conversation/code', source: 'builtin' },
  { name: 'review', description: 'Request code review', source: 'builtin' },
  { name: 'security-review', description: 'Security review of changes', source: 'builtin' },
  { name: 'init', description: 'Initialize CLAUDE.md', source: 'builtin' },
];
