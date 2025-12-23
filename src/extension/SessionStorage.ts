import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { StoredSession } from '../shared/types';

export interface ClaudeSessionEntry {
  type: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  sessionId?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
    model?: string;
    id?: string;
  };
  uuid?: string;
  timestamp?: string;
  isMeta?: boolean;
}

// Re-export StoredSession for convenience
export type { StoredSession };

/**
 * Converts a workspace path to Claude Code CLI's project folder name format.
 * Example: "C:\GameDev\claude-unbound" -> "C--GameDev-claude-unbound"
 *
 * Security: Rejects paths containing ".." to prevent path traversal attacks.
 */
export function encodeProjectPath(workspacePath: string): string {
  // Security check: reject paths with ".." to prevent directory traversal
  if (workspacePath.includes('..')) {
    throw new Error('Invalid workspace path: path traversal not allowed');
  }

  // Normalize path separators and remove trailing slash
  let normalized = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');

  // On Windows, convert drive letter format: "C:/..." -> "C-/..."
  // Then replace all "/" with "-"
  normalized = normalized.replace(/:/g, '-').replace(/\//g, '-');

  return normalized;
}

/**
 * Gets the Claude Code CLI projects directory.
 * Default: ~/.claude/projects
 */
export function getClaudeProjectsDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude', 'projects');
}

/**
 * Gets the session storage directory for a specific workspace.
 */
export function getSessionDir(workspacePath: string): string {
  const projectsDir = getClaudeProjectsDir();
  const encodedPath = encodeProjectPath(workspacePath);
  return path.join(projectsDir, encodedPath);
}

/**
 * Ensures the session directory exists.
 */
export async function ensureSessionDir(workspacePath: string): Promise<string> {
  const sessionDir = getSessionDir(workspacePath);
  await fs.promises.mkdir(sessionDir, { recursive: true });
  return sessionDir;
}

/**
 * Lists all available sessions for a workspace.
 */
export async function listSessions(workspacePath: string): Promise<StoredSession[]> {
  const sessionDir = getSessionDir(workspacePath);

  try {
    const files = await fs.promises.readdir(sessionDir);
    const sessions: StoredSession[] = [];

    for (const file of files) {
      // Only process UUID-based JSONL files (skip agent-* files)
      if (!file.endsWith('.jsonl') || file.startsWith('agent-')) {
        continue;
      }

      const sessionId = file.replace('.jsonl', '');
      const filePath = path.join(sessionDir, file);

      try {
        const stat = await fs.promises.stat(filePath);
        const sessionData = await parseSessionFile(filePath);

        if (sessionData.preview) {
          sessions.push({
            id: sessionId,
            timestamp: stat.mtime.getTime(),
            preview: sessionData.preview,
            slug: sessionData.slug,
            messageCount: sessionData.messageCount,
          });
        }
      } catch (err) {
        // Skip files that can't be read
        continue;
      }
    }

    // Sort by timestamp descending (most recent first)
    sessions.sort((a, b) => b.timestamp - a.timestamp);

    return sessions;
  } catch (err) {
    // Directory doesn't exist yet
    return [];
  }
}

/**
 * Parses a session JSONL file to extract metadata.
 */
async function parseSessionFile(filePath: string): Promise<{
  preview: string;
  slug?: string;
  messageCount: number;
}> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  let preview = '';
  let slug: string | undefined;
  let messageCount = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry: ClaudeSessionEntry = JSON.parse(line);

      // Get slug from first entry that has it
      if (!slug && entry.slug) {
        slug = entry.slug;
      }

      // Count non-meta user messages and assistant messages
      if (entry.type === 'user' && !entry.isMeta && entry.message) {
        messageCount++;
        // Get first user message as preview
        if (!preview) {
          const content = entry.message.content;
          if (typeof content === 'string') {
            // Skip command messages for preview
            if (!content.startsWith('<command-') && !content.startsWith('<local-command-')) {
              preview = extractPreviewText(content);
            }
          } else if (Array.isArray(content)) {
            const textBlock = content.find(b => b.type === 'text' && b.text);
            if (textBlock?.text && !textBlock.text.startsWith('<command-')) {
              preview = extractPreviewText(textBlock.text);
            }
          }
        }
      } else if (entry.type === 'assistant' && entry.message) {
        messageCount++;
      }
    } catch (err) {
      // Skip malformed lines
      continue;
    }
  }

  return { preview, slug, messageCount };
}

/**
 * Extracts a clean preview text from message content.
 */
function extractPreviewText(content: string): string {
  // Remove XML-like tags
  let text = content.replace(/<[^>]+>/g, ' ');
  // Remove markdown formatting
  text = text.replace(/[#*_`]/g, '');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  // Truncate to 100 chars
  return text.slice(0, 100);
}

/**
 * Gets the full path to a session file.
 */
export function getSessionFilePath(workspacePath: string, sessionId: string): string {
  const sessionDir = getSessionDir(workspacePath);
  return path.join(sessionDir, `${sessionId}.jsonl`);
}

/**
 * Reads all entries from a session file.
 */
export async function readSessionEntries(workspacePath: string, sessionId: string): Promise<ClaudeSessionEntry[]> {
  const filePath = getSessionFilePath(workspacePath, sessionId);

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const entries: ClaudeSessionEntry[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        continue;
      }
    }

    return entries;
  } catch (err) {
    return [];
  }
}

/**
 * Checks if a session file exists.
 */
export async function sessionExists(workspacePath: string, sessionId: string): Promise<boolean> {
  const filePath = getSessionFilePath(workspacePath, sessionId);
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
