import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { StoredSession } from '../shared/types';
import { stripControlChars, extractSlashCommandDisplay } from '../shared/utils';
import { log } from './logger';

const EXTENSION_VERSION = '2.0.76';

const INTERRUPT_MARKER = '[Request interrupted by user]';

const SDK_GENERATED_PREFIXES = [
  '[Request interrupted by user',
  'This session is being continued from a previous conversation',
];

/**
 * Content block types as stored in JSONL by Claude Code CLI.
 * These match the SDK's content block structure.
 */
export type JsonlContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export function findUserTextBlock(
  content: JsonlContentBlock[]
): { type: 'text'; text: string } | undefined {
  return content.find(
    (b): b is { type: 'text'; text: string } =>
      b.type === 'text' && typeof b.text === 'string' && !b.text.startsWith('<ide_')
  );
}

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
  customTitle?: string;  // User-set name via /rename
  isInterrupt?: boolean;  // Marks user entries that are interrupt markers
  message?: {
    role: string;
    content: string | JsonlContentBlock[];
    model?: string;
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  uuid?: string;
  timestamp?: string;
  isMeta?: boolean;
  // Tool result metadata (present on user entries that are tool results)
  toolUseResult?: {
    type?: string;
    filePath?: string;
    oldString?: string;
    newString?: string;
    originalFile?: string;
  };
}

// Re-export StoredSession for convenience
export type { StoredSession };

/**
 * Parses a JSONL line and sanitizes string content to remove control characters.
 * This is the single point of sanitization for all JSONL data.
 */
function parseSessionEntry(line: string): ClaudeSessionEntry {
  const entry: ClaudeSessionEntry = JSON.parse(line);

  if (entry.message?.content) {
    if (typeof entry.message.content === 'string') {
      entry.message.content = stripControlChars(entry.message.content);
    } else if (Array.isArray(entry.message.content)) {
      entry.message.content = entry.message.content.map(block => {
        if (block.type === 'text' && typeof block.text === 'string') {
          return { ...block, text: stripControlChars(block.text) };
        }
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
          return { ...block, thinking: stripControlChars(block.thinking) };
        }
        if (block.type === 'tool_result' && typeof block.content === 'string') {
          return { ...block, content: stripControlChars(block.content) };
        }
        return block;
      });
    }
  }

  return entry;
}

/**
 * UUID v4 regex pattern for validating session IDs.
 * Session IDs from Claude Code CLI are always UUIDs.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a session ID is a valid UUID format.
 * This prevents path injection attacks via malformed session IDs.
 */
export function isValidSessionId(sessionId: string): boolean {
  return UUID_PATTERN.test(sessionId);
}

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

  // On Windows, normalize drive letter to uppercase to match CLI behavior
  // CLI creates directories like "C--GameDev-..." with uppercase drive letter
  if (/^[a-z]:/.test(normalized)) {
    normalized = normalized[0].toUpperCase() + normalized.slice(1);
  }

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
 * Tries multiple path variations to match CLI behavior (underscore ↔ dash).
 */
export async function getSessionDir(workspacePath: string): Promise<string> {
  const projectsDir = getClaudeProjectsDir();
  const encodedPath = encodeProjectPath(workspacePath);
  const primaryPath = path.join(projectsDir, encodedPath);

  // Try the primary path first
  try {
    await fs.promises.access(primaryPath, fs.constants.R_OK);
    return primaryPath;
  } catch {
    // Primary path doesn't exist, try variations
  }

  // Try underscore → dash variation (CLI sometimes normalizes underscores to dashes)
  // Note: We only do underscore→dash because dash→underscore would corrupt
  // the drive letter encoding (C-- → C__) and path separators
  const variations = [
    encodedPath.replace(/_/g, '-'),  // underscore to dash (safe)
  ];

  for (const variant of variations) {
    // Don't try if it's the same as primary
    if (variant === encodedPath) continue;

    const variantPath = path.join(projectsDir, variant);
    try {
      await fs.promises.access(variantPath, fs.constants.R_OK);
      return variantPath;
    } catch {
      // This variation doesn't exist either
    }
  }

  // Return primary path (will be created if needed)
  return primaryPath;
}

/**
 * Gets the session storage directory synchronously (for paths only, no existence check).
 */
export function getSessionDirSync(workspacePath: string): string {
  const projectsDir = getClaudeProjectsDir();
  const encodedPath = encodeProjectPath(workspacePath);
  return path.join(projectsDir, encodedPath);
}

/**
 * Ensures the session directory exists.
 */
export async function ensureSessionDir(workspacePath: string): Promise<string> {
  const sessionDir = await getSessionDir(workspacePath);
  await fs.promises.mkdir(sessionDir, { recursive: true });
  return sessionDir;
}

/**
 * Lists all available sessions for a workspace.
 */
export async function listSessions(workspacePath: string): Promise<StoredSession[]> {
  const sessionDir = await getSessionDir(workspacePath);

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

        // Skip empty files (0 bytes = no session content)
        if (stat.size === 0) {
          continue;
        }

        const sessionData = await parseSessionFile(filePath);

        // Skip sessions with no displayable messages (only metadata/summaries)
        if (sessionData.messageCount === 0) {
          continue;
        }

        sessions.push({
          id: sessionId,
          timestamp: stat.mtime.getTime(),
          preview: sessionData.preview || 'Session started...',
          slug: sessionData.slug,
          customTitle: sessionData.customTitle,
          messageCount: sessionData.messageCount,
        });
      } catch (err) {
        // Skip files that can't be read
        continue;
      }
    }

    // Sort by timestamp descending (most recent first)
    sessions.sort((a, b) => b.timestamp - a.timestamp);

    return sessions;
  } catch {
    // Directory doesn't exist yet
    return [];
  }
}

/**
 * Gets metadata for a single session file.
 * Returns null if the session doesn't exist or is invalid.
 */
export async function getSessionMetadata(workspacePath: string, sessionId: string): Promise<StoredSession | null> {
  if (!isValidSessionId(sessionId)) {
    return null;
  }

  const sessionDir = await getSessionDir(workspacePath);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) {
      return null;
    }

    const sessionData = await parseSessionFile(filePath);
    if (sessionData.messageCount === 0) {
      return null;
    }

    return {
      id: sessionId,
      timestamp: stat.mtime.getTime(),
      preview: sessionData.preview || 'Session started...',
      slug: sessionData.slug,
      customTitle: sessionData.customTitle,
      messageCount: sessionData.messageCount,
    };
  } catch {
    return null;
  }
}

/**
 * Parses a session JSONL file to extract metadata.
 */
async function parseSessionFile(filePath: string): Promise<{
  preview: string;
  slug?: string;
  customTitle?: string;
  messageCount: number;
}> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  let preview = '';
  let slug: string | undefined;
  let customTitle: string | undefined;
  let messageCount = 0;
  let hasAssistantMessage = false;

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry = parseSessionEntry(line);

      // Get custom title from custom-title entry (user-set name via /rename)
      if (entry.type === 'custom-title' && entry.customTitle) {
        customTitle = entry.customTitle;
      }

      // Get slug from first entry that has it
      if (!slug && entry.slug) {
        slug = entry.slug;
      }

      // Skip non-message entries (like file-history-snapshot, system entries)
      if (entry.type !== 'user' && entry.type !== 'assistant') {
        continue;
      }

      // Count non-meta user messages and assistant messages
      if (entry.type === 'user' && !entry.isMeta && entry.message) {
        messageCount++;
        // Get first user message as preview
        if (!preview) {
          const msgContent = entry.message.content;
          if (typeof msgContent === 'string') {
            let textToPreview = msgContent;

            // Handle slash commands: extract content after the command
            // e.g., "/task ## Task: ..." -> "## Task: ..."
            if (msgContent.startsWith('/')) {
              const spaceIndex = msgContent.indexOf(' ');
              if (spaceIndex > 0) {
                textToPreview = msgContent.slice(spaceIndex + 1);
              }
            }

            preview = extractPreviewText(textToPreview);
          } else if (Array.isArray(msgContent)) {
            const textBlock = findUserTextBlock(msgContent as JsonlContentBlock[]);
            if (textBlock) {
              let textToPreview = textBlock.text;

              // Handle slash commands in array content too
              if (textToPreview.startsWith('/')) {
                const spaceIndex = textToPreview.indexOf(' ');
                if (spaceIndex > 0) {
                  textToPreview = textToPreview.slice(spaceIndex + 1);
                }
              }

              preview = extractPreviewText(textToPreview);
            }
          }
        }
      } else if (entry.type === 'assistant' && entry.message) {
        messageCount++;
        hasAssistantMessage = true;
      }
    } catch (err) {
      // Skip malformed lines
      continue;
    }
  }

  // Sessions must have at least one assistant response to be considered "real"
  // conversations. Sessions without assistant responses are:
  // - Abandoned sessions (user typed something but never got a response)
  // - Command-only sessions (e.g., "/config" that opens settings)
  // - Summarized/compacted sessions where original messages were removed
  // The CLI filters these out too - they clutter the session list.
  if (!hasAssistantMessage) {
    messageCount = 0;  // This will cause the session to be filtered out
  }

  return { preview, slug, customTitle, messageCount };
}

/**
 * Extracts a clean preview text from message content.
 * For command messages, shows the command name with args (like CLI does).
 * Note: Control characters are already stripped at JSONL parse time.
 */
function extractPreviewText(content: string): string {
  const commandDisplay = extractSlashCommandDisplay(content);
  if (commandDisplay) {
    return commandDisplay.slice(0, 100);
  }

  if (content.startsWith('<local-command-')) {
    return '';
  }

  let text = content.replace(/<[^>]+>/g, ' ');
  text = text.replace(/[#*_`]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, 100);
}

/**
 * Gets the full path to a session file.
 * Security: Validates sessionId format to prevent path injection.
 */
export async function getSessionFilePath(workspacePath: string, sessionId: string): Promise<string> {
  if (!isValidSessionId(sessionId)) {
    throw new Error('Invalid session ID format');
  }
  const sessionDir = await getSessionDir(workspacePath);
  return path.join(sessionDir, `${sessionId}.jsonl`);
}

/**
 * Reads all entries from a session file.
 */
export async function readSessionEntries(workspacePath: string, sessionId: string): Promise<ClaudeSessionEntry[]> {
  const filePath = await getSessionFilePath(workspacePath, sessionId);

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const entries: ClaudeSessionEntry[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(parseSessionEntry(line));
      } catch {
        continue;
      }
    }

    return entries;
  } catch (err) {
    return [];
  }
}

export interface ExtractedSessionStats {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  numTurns: number;
  contextWindowSize: number;
}

export async function extractSessionStats(
  workspacePath: string,
  sessionId: string
): Promise<ExtractedSessionStats | undefined> {
  const entries = await readSessionEntries(workspacePath, sessionId);

  const assistantEntries = entries.filter(e =>
    e.type === 'assistant' && e.message?.usage && !e.isSidechain
  );

  if (assistantEntries.length === 0) return undefined;

  // Deduplicate by message ID and track if message had tool calls
  const messageData = new Map<string, {
    usage: NonNullable<ClaudeSessionEntry['message']>['usage'];
    hadTools: boolean;
  }>();

  for (const entry of assistantEntries) {
    const usage = entry.message?.usage;
    const messageId = entry.message?.id;
    const content = entry.message?.content;
    if (!usage || !messageId) continue;

    // Check if this message has tool_use blocks
    const hadTools = Array.isArray(content) &&
      content.some(block => typeof block === 'object' && 'type' in block && block.type === 'tool_use');

    messageData.set(messageId, { usage, hadTools });
  }

  // Sum output tokens across all messages
  let totalOutputTokens = 0;
  for (const data of messageData.values()) {
    totalOutputTokens += data.usage?.output_tokens ?? 0;
  }

  // Get the LAST message's context stats (represents current session state)
  const lastEntry = Array.from(messageData.values()).pop();
  if (!lastEntry) return undefined;

  const { usage, hadTools } = lastEntry;
  // Apply divide-by-2 if the last message had tools (same logic as live stats)
  // Note: This is an approximation for single-tool turns. With N tools it's (N+1)x.
  const divisor = hadTools ? 2 : 1;

  const inputTokens = usage?.input_tokens ?? 0;
  const cacheCreation = usage?.cache_creation_input_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;

  return {
    totalCostUsd: 0,
    totalInputTokens: Math.round(inputTokens / divisor),
    totalOutputTokens,
    cacheCreationTokens: Math.round(cacheCreation / divisor),
    cacheReadTokens: Math.round(cacheRead / divisor),
    numTurns: messageData.size,
    // TODO: Extract actual context window from JSONL modelUsage field when available
    contextWindowSize: 200000,
  };
}

/**
 * Result of paginated session reading.
 */
export interface PaginatedSessionResult {
  entries: ClaudeSessionEntry[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number;
}

/**
 * Checks if an entry is a displayable message (user or assistant, non-meta).
 */
function isDisplayableMessage(entry: ClaudeSessionEntry): boolean {
  if (entry.type === 'user' && entry.message && !entry.isMeta) {
    return true;
  }
  if (entry.type === 'assistant' && entry.message) {
    return true;
  }
  return false;
}

/**
 * Reads session entries with pagination, returning entries from newest to oldest.
 * Only counts and paginates displayable messages (user/assistant), not metadata.
 *
 * @param workspacePath - The workspace path
 * @param sessionId - The session ID (UUID)
 * @param offset - Number of MESSAGES to skip from the END (most recent)
 * @param limit - Maximum number of MESSAGES to return
 * @returns Paginated result with entries (in chronological order for display)
 */
export async function readSessionEntriesPaginated(
  workspacePath: string,
  sessionId: string,
  offset: number = 0,
  limit: number = 50
): Promise<PaginatedSessionResult> {
  const filePath = await getSessionFilePath(workspacePath, sessionId);

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    // Parse all entries and filter to only displayable messages
    const displayableEntries: ClaudeSessionEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = parseSessionEntry(line);
        if (isDisplayableMessage(entry)) {
          displayableEntries.push(entry);
        }
      } catch {
        continue;
      }
    }

    const totalCount = displayableEntries.length;

    // Calculate slice from end: if offset=0, limit=20, get last 20 messages
    // If offset=20, limit=20, get messages 20-40 from the end
    const endIndex = totalCount - offset;
    const startIndex = Math.max(0, endIndex - limit);

    // Slice entries (returns in chronological order for display)
    const entries = displayableEntries.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;
    const nextOffset = offset + entries.length;

    return { entries, totalCount, hasMore, nextOffset };
  } catch (err) {
    return { entries: [], totalCount: 0, hasMore: false, nextOffset: 0 };
  }
}

/**
 * Checks if a session file exists.
 */
export async function sessionExists(workspacePath: string, sessionId: string): Promise<boolean> {
  const filePath = await getSessionFilePath(workspacePath, sessionId);
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Renames a session by setting a custom-title entry in the session file.
 * This matches the Claude Code CLI /rename command behavior.
 *
 * Unlike simply appending, this function replaces any existing custom-title
 * entry to prevent duplication issues in the CLI's /resume picker.
 *
 * Uses atomic write (temp file → rename) to prevent file corruption on crashes.
 */
export async function renameSession(workspacePath: string, sessionId: string, newName: string): Promise<void> {
  const filePath = await getSessionFilePath(workspacePath, sessionId);

  // Validate input
  if (!newName.trim()) {
    throw new Error('Session name cannot be empty');
  }

  // Sanitize: remove control characters (newlines, tabs, etc.) that could corrupt JSONL
  const sanitizedName = newName.trim().replace(/[\x00-\x1F\x7F]/g, '');
  if (!sanitizedName) {
    throw new Error('Session name cannot contain only control characters');
  }

  // Read and parse all lines
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  // Remove any existing custom-title entries and collect other entries
  const otherLines: string[] = [];
  for (const line of lines) {
    try {
      const entry = parseSessionEntry(line);
      if (entry.type !== 'custom-title') {
        otherLines.push(line);
      }
    } catch {
      // Keep malformed lines as-is
      otherLines.push(line);
    }
  }

  // Create the new custom-title entry
  const customTitleEntry = {
    type: 'custom-title',
    customTitle: sanitizedName,
    sessionId: sessionId,
  };

  // Atomic write: write to temp file, then rename
  // This prevents file corruption if a crash occurs during write
  const newContent = [...otherLines, JSON.stringify(customTitleEntry)].join('\n') + '\n';
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    await fs.promises.writeFile(tempPath, newContent);
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    // Clean up temp file if rename failed
    try {
      await fs.promises.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

export async function deleteSession(workspacePath: string, sessionId: string): Promise<void> {
  if (!isValidSessionId(sessionId)) {
    throw new Error('Invalid session ID format');
  }

  const filePath = await getSessionFilePath(workspacePath, sessionId);

  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

export interface PersistUserMessageOptions {
  workspacePath: string;
  sessionId: string;
  content: string | Array<{ type: string; text: string }>;
  parentUuid?: string | null;
  gitBranch?: string;
}

export async function persistUserMessage(options: PersistUserMessageOptions): Promise<string> {
  const { workspacePath, sessionId, content, parentUuid, gitBranch } = options;
  const messageUuid = crypto.randomUUID();
  const normalizedContent = typeof content === 'string'
    ? [{ type: 'text', text: content }]
    : content;
  const timestamp = new Date().toISOString();
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.promises.mkdir(sessionDir, { recursive: true });

  const snapshotEntry = {
    type: 'file-history-snapshot',
    messageId: messageUuid,
    snapshot: {
      messageId: messageUuid,
      trackedFileBackups: {},
      timestamp,
    },
    isSnapshotUpdate: false,
  };

  const userEntry = {
    parentUuid: parentUuid ?? null,
    isSidechain: false,
    userType: 'external',
    cwd: workspacePath,
    sessionId,
    version: EXTENSION_VERSION,
    gitBranch: gitBranch ?? 'main',
    type: 'user',
    message: {
      role: 'user',
      content: normalizedContent,
    },
    uuid: messageUuid,
    timestamp,
    thinkingMetadata: { level: 'high', disabled: false, triggers: [] },
    todos: [],
  };

  const lines = [JSON.stringify(snapshotEntry), JSON.stringify(userEntry)].join('\n') + '\n';
  await fs.promises.appendFile(filePath, lines);

  return messageUuid;
}

export async function initializeSession(workspacePath: string, sessionId: string): Promise<void> {
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.promises.mkdir(sessionDir, { recursive: true });

  const queueEntry = {
    type: 'queue-operation',
    operation: 'dequeue',
    timestamp: new Date().toISOString(),
    sessionId,
  };

  await fs.promises.writeFile(filePath, JSON.stringify(queueEntry) + '\n');
}

export interface PersistPartialAssistantOptions {
  workspacePath: string;
  sessionId: string;
  parentUuid: string;
  thinking?: string;
  text?: string;
  model?: string;
  gitBranch?: string;
}

export async function persistPartialAssistant(options: PersistPartialAssistantOptions): Promise<string> {
  const { workspacePath, sessionId, parentUuid, text, model, gitBranch } = options;
  // NOTE: We intentionally don't persist thinking here because:
  // 1. The SDK already writes thinking with the required `signature` field
  // 2. Thinking blocks without signature cause API errors ("Field required")
  // We only persist TEXT that the SDK didn't get a chance to write

  if (!text) {
    return parentUuid;
  }

  const messageUuid = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  const content: Array<{ type: string; text?: string }> = [];
  content.push({ type: 'text', text });

  const assistantEntry = {
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd: workspacePath,
    sessionId,
    version: EXTENSION_VERSION,
    gitBranch: gitBranch ?? 'main',
    type: 'assistant',
    message: {
      id: `partial-${messageUuid}`,
      model: model ?? 'claude-opus-4-5-20251101',
      type: 'message',
      role: 'assistant',
      content,
      stop_reason: 'interrupted',
    },
    uuid: messageUuid,
    timestamp,
  };

  await fs.promises.appendFile(filePath, JSON.stringify(assistantEntry) + '\n');

  return messageUuid;
}

export interface PersistInterruptOptions {
  workspacePath: string;
  sessionId: string;
  parentUuid: string;
  gitBranch?: string;
}

export async function persistInterruptMarker(options: PersistInterruptOptions): Promise<string> {
  const { workspacePath, sessionId, parentUuid, gitBranch } = options;
  const messageUuid = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  const interruptEntry = {
    parentUuid,
    isSidechain: false,
    userType: 'external',
    cwd: workspacePath,
    sessionId,
    version: EXTENSION_VERSION,
    gitBranch: gitBranch ?? 'main',
    type: 'user',
    isInterrupt: true,
    message: {
      role: 'user',
      content: [{ type: 'text', text: INTERRUPT_MARKER }],
    },
    uuid: messageUuid,
    timestamp,
  };

  await fs.promises.appendFile(filePath, JSON.stringify(interruptEntry) + '\n');

  return messageUuid;
}

export async function getLastMessageUuid(workspacePath: string, sessionId: string): Promise<string | null> {
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        const entry = parseSessionEntry(line);
        if ((entry.type === 'user' || entry.type === 'assistant') && entry.uuid) {
          return entry.uuid;
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function findUserMessageInCurrentTurn(
  workspacePath: string,
  sessionId: string
): Promise<{ uuid: string; content: string } | null> {
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  try {
    const fileContent = await fs.promises.readFile(filePath, 'utf-8');
    const lines = fileContent.trim().split('\n');

    // Find the last queue-operation dequeue (marks start of current turn)
    let lastQueueOpIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        const entry = parseSessionEntry(line);
        if (entry.type === 'queue-operation' && (entry as { operation?: string }).operation === 'dequeue') {
          lastQueueOpIndex = i;
          break;
        }
      } catch {
        continue;
      }
    }

    // Look for user message AFTER the queue-operation (in current turn)
    for (let i = lastQueueOpIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        const entry = parseSessionEntry(line);

        if (entry.type === 'user' && entry.uuid) {
          const messageContent = Array.isArray(entry.message?.content)
            ? entry.message.content
                .filter((c): c is { type: 'text'; text: string } =>
                  typeof c === 'object' && c !== null && 'type' in c && c.type === 'text')
                .map(c => c.text)
                .join('')
            : '';

          // Skip interrupt markers
          if (messageContent === INTERRUPT_MARKER) {
            continue;
          }

          return { uuid: entry.uuid, content: messageContent };
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function findLastMessageInCurrentTurn(
  workspacePath: string,
  sessionId: string
): Promise<string | null> {
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  try {
    const fileContent = await fs.promises.readFile(filePath, 'utf-8');
    const lines = fileContent.trim().split('\n');

    // Find the last queue-operation dequeue (marks start of current turn)
    let lastQueueOpIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        const entry = parseSessionEntry(line);
        if (entry.type === 'queue-operation' && (entry as { operation?: string }).operation === 'dequeue') {
          lastQueueOpIndex = i;
          break;
        }
      } catch {
        continue;
      }
    }

    // Find the LAST user/assistant message in the current turn (scanning backwards from end)
    for (let i = lines.length - 1; i > lastQueueOpIndex; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        const entry = parseSessionEntry(line);
        if ((entry.type === 'user' || entry.type === 'assistant') && entry.uuid) {
          return entry.uuid;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

const COMMAND_HISTORY_PAGE_SIZE = 50;
const MAX_COMMAND_HISTORY = 500;

export async function extractCommandHistory(
  workspacePath: string,
  offset: number = 0
): Promise<{ history: string[]; hasMore: boolean }> {
  const sessions = await listSessions(workspacePath);
  const seen = new Set<string>();
  const allHistory: string[] = [];
  const targetEnd = offset + COMMAND_HISTORY_PAGE_SIZE + 1;

  for (const session of sessions) {
    if (allHistory.length >= Math.min(targetEnd, MAX_COMMAND_HISTORY)) break;

    const entries = await readSessionEntries(workspacePath, session.id);

    const userPrompts: { text: string; timestamp: string }[] = [];
    for (const entry of entries) {
      if (entry.type !== 'user') continue;
      if (entry.userType !== 'external') continue;
      if (entry.isMeta || entry.isInterrupt) continue;
      if (entry.toolUseResult) continue;
      if (!entry.message?.content) continue;

      const text = extractUserMessageText(entry.message.content);
      if (!text || text.trim().length === 0) continue;
      if (isSdkGeneratedMessage(text)) continue;

      userPrompts.push({ text: text.trim(), timestamp: entry.timestamp || '' });
    }

    userPrompts.reverse();

    for (const { text } of userPrompts) {
      if (allHistory.length >= Math.min(targetEnd, MAX_COMMAND_HISTORY)) break;
      if (seen.has(text)) continue;

      seen.add(text);
      allHistory.push(text);
    }
  }

  const pageItems = allHistory.slice(offset, offset + COMMAND_HISTORY_PAGE_SIZE);
  const hasMore = allHistory.length > offset + COMMAND_HISTORY_PAGE_SIZE;

  return { history: pageItems, hasMore };
}

function extractUserMessageText(content: string | JsonlContentBlock[]): string {
  if (typeof content === 'string') {
    return cleanCommandWrapper(content);
  }

  if (Array.isArray(content)) {
    const textBlock = findUserTextBlock(content);
    if (textBlock) {
      return cleanCommandWrapper(textBlock.text);
    }
  }

  return '';
}

/**
 * Extracts display text from command XML wrappers.
 * Note: Control characters are already stripped at JSONL parse time.
 */
function cleanCommandWrapper(text: string): string {
  const commandDisplay = extractSlashCommandDisplay(text);
  if (commandDisplay) {
    return commandDisplay;
  }

  if (text.startsWith('<local-command-')) {
    return '';
  }

  return text;
}

function isSdkGeneratedMessage(text: string): boolean {
  return SDK_GENERATED_PREFIXES.some(prefix => text.startsWith(prefix));
}
