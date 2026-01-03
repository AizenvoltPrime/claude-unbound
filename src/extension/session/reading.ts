import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';
import type {
  ClaudeSessionEntry,
  JsonlContentBlock,
  StoredSession,
  AgentData,
  AgentToolCall,
  ExtractedSessionStats,
  CompactInfo,
  PaginatedSessionResult,
} from './types';
import { TOOL_RESULT_PREVIEW_LENGTH, COMPACT_SUMMARY_SEARCH_DEPTH, isContentBlockArray } from './types';
import { getSessionDir, getSessionFilePath, getAgentFilePath, buildSessionFilePath, isValidSessionId } from './paths';
import {
  readSessionFileLines,
  parseSessionEntry,
  parseAllSessionEntries,
  findUserTextBlock,
  isDisplayableMessage,
  extractPreviewText,
  extractTextFromSlashCommand,
} from './parsing';
import { getActiveBranchUuids, getInjectedMessageUuids } from './branches';

async function parseSessionFile(filePath: string): Promise<{
  preview: string;
  slug?: string;
  customTitle?: string;
  messageCount: number;
}> {
  const lines = await readSessionFileLines(filePath);

  let preview = '';
  let slug: string | undefined;
  let customTitle: string | undefined;
  let messageCount = 0;
  let hasAssistantMessage = false;

  for (const line of lines) {
    try {
      const entry = parseSessionEntry(line);

      if (entry.type === 'custom-title' && entry.customTitle) {
        customTitle = entry.customTitle;
      }

      if (!slug && entry.slug) {
        slug = entry.slug;
      }

      if (entry.type !== 'user' && entry.type !== 'assistant') {
        continue;
      }

      if (entry.type === 'user' && !entry.isMeta && entry.message) {
        messageCount++;
        if (!preview) {
          const msgContent = entry.message.content;
          if (typeof msgContent === 'string') {
            const textToPreview = extractTextFromSlashCommand(msgContent);
            preview = extractPreviewText(textToPreview);
          } else if (isContentBlockArray(msgContent)) {
            const textBlock = findUserTextBlock(msgContent);
            if (textBlock) {
              const textToPreview = extractTextFromSlashCommand(textBlock.text);
              preview = extractPreviewText(textToPreview);
            }
          }
        }
      } else if (entry.type === 'assistant' && entry.message) {
        messageCount++;
        hasAssistantMessage = true;
      }
    } catch {
      continue;
    }
  }

  if (!hasAssistantMessage) {
    messageCount = 0;
  }

  return { preview, slug, customTitle, messageCount };
}

export async function listSessions(workspacePath: string): Promise<StoredSession[]> {
  const sessionDir = await getSessionDir(workspacePath);

  try {
    const files = await fs.promises.readdir(sessionDir);
    const sessions: StoredSession[] = [];

    for (const file of files) {
      if (!file.endsWith('.jsonl') || file.startsWith('agent-')) {
        continue;
      }

      const sessionId = file.replace('.jsonl', '');
      const filePath = path.join(sessionDir, file);

      try {
        const stat = await fs.promises.stat(filePath);

        if (stat.size === 0) {
          continue;
        }

        const sessionData = await parseSessionFile(filePath);

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
      } catch {
        continue;
      }
    }

    sessions.sort((a, b) => b.timestamp - a.timestamp);

    return sessions;
  } catch {
    return [];
  }
}

export async function getSessionMetadata(workspacePath: string, sessionId: string): Promise<StoredSession | null> {
  if (!isValidSessionId(sessionId)) {
    return null;
  }

  const sessionDir = await getSessionDir(workspacePath);
  const filePath = buildSessionFilePath(sessionDir, sessionId);

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

export async function sessionExists(workspacePath: string, sessionId: string): Promise<boolean> {
  const filePath = await getSessionFilePath(workspacePath, sessionId);
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readSessionEntries(workspacePath: string, sessionId: string): Promise<ClaudeSessionEntry[]> {
  const filePath = await getSessionFilePath(workspacePath, sessionId);

  try {
    const lines = await readSessionFileLines(filePath);
    return parseAllSessionEntries(lines);
  } catch {
    return [];
  }
}

export async function readActiveBranchEntries(
  workspacePath: string,
  sessionId: string,
  customLeaf?: string
): Promise<ClaudeSessionEntry[]> {
  const allEntries = await readSessionEntries(workspacePath, sessionId);
  const activeUuids = getActiveBranchUuids(allEntries, customLeaf);
  return allEntries.filter(entry => entry.uuid && activeUuids.has(entry.uuid));
}

export async function readAgentData(workspacePath: string, agentId: string): Promise<AgentData> {
  const filePath = await getAgentFilePath(workspacePath, agentId);

  try {
    const lines = await readSessionFileLines(filePath);

    const toolCalls: AgentToolCall[] = [];
    const toolResults = new Map<string, string>();
    let model: string | undefined;

    for (const line of lines) {
      try {
        const entry = parseSessionEntry(line);

        if (entry.type === 'user' && entry.message && isContentBlockArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_result') {
              const resultContent = typeof block.content === 'string'
                ? block.content.slice(0, TOOL_RESULT_PREVIEW_LENGTH)
                : JSON.stringify(block.content).slice(0, TOOL_RESULT_PREVIEW_LENGTH);
              toolResults.set(block.tool_use_id, resultContent);
            }
          }
        }

        if (entry.type === 'assistant' && entry.message) {
          if (!model && entry.message.model) {
            model = entry.message.model as string;
          }
          if (isContentBlockArray(entry.message.content)) {
            for (const block of entry.message.content) {
              if (block.type === 'tool_use') {
                toolCalls.push({
                  id: block.id,
                  name: block.name,
                  input: block.input,
                });
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    for (const tool of toolCalls) {
      const result = toolResults.get(tool.id);
      if (result) {
        tool.result = result;
      }
    }

    return { toolCalls, model };
  } catch {
    return { toolCalls: [] };
  }
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

  const messageData = new Map<string, {
    usage: NonNullable<ClaudeSessionEntry['message']>['usage'];
  }>();

  for (const entry of assistantEntries) {
    const usage = entry.message?.usage;
    const messageId = entry.message?.id;
    if (!usage || !messageId) continue;

    messageData.set(messageId, { usage });
  }

  let totalOutputTokens = 0;
  for (const data of messageData.values()) {
    totalOutputTokens += data.usage?.output_tokens ?? 0;
  }

  const lastEntry = Array.from(messageData.values()).pop();
  if (!lastEntry) return undefined;

  const { usage } = lastEntry;

  const inputTokens = usage?.input_tokens ?? 0;
  const cacheCreation = usage?.cache_creation_input_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;

  return {
    totalCostUsd: 0,
    totalInputTokens: inputTokens,
    totalOutputTokens,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    numTurns: messageData.size,
    contextWindowSize: 200000,
  };
}

function extractCompactInfo(
  allEntries: ClaudeSessionEntry[],
  activeUuids: Set<string>
): { compactInfo: CompactInfo | undefined; compactEntry: ClaudeSessionEntry | undefined } {
  let lastCompactEntry: ClaudeSessionEntry | undefined;
  for (let i = allEntries.length - 1; i >= 0; i--) {
    const entry = allEntries[i];
    if (entry.type === 'system' && entry.subtype === 'compact_boundary' && entry.uuid && activeUuids.has(entry.uuid)) {
      lastCompactEntry = entry;
      break;
    }
  }

  if (!lastCompactEntry) {
    return { compactInfo: undefined, compactEntry: undefined };
  }

  const metadata = lastCompactEntry.compactMetadata;
  if (!metadata) {
    return { compactInfo: undefined, compactEntry: lastCompactEntry };
  }

  const timestamp = lastCompactEntry.timestamp ? new Date(lastCompactEntry.timestamp).getTime() : Date.now();
  const compactUuid = lastCompactEntry.uuid;
  const compactIndexInAll = allEntries.findIndex(e => e.uuid === compactUuid);

  let summary: string | undefined;
  for (let i = compactIndexInAll + 1; i < allEntries.length; i++) {
    const entry = allEntries[i];
    if (entry.isCompactSummary && entry.message?.content) {
      summary = typeof entry.message.content === 'string' ? entry.message.content : '';
      break;
    }
  }

  return {
    compactInfo: {
      trigger: metadata.trigger,
      preTokens: metadata.preTokens,
      summary,
      timestamp,
    },
    compactEntry: lastCompactEntry,
  };
}

function filterDisplayableEntries(
  allEntries: ClaudeSessionEntry[],
  activeUuids: Set<string>,
  injectedUuids: Set<string>,
  compactTimestamp: number | undefined
): ClaudeSessionEntry[] {
  return allEntries.filter(entry => {
    if (!isDisplayableMessage(entry)) return false;
    if (!entry.uuid) return false;
    if (!activeUuids.has(entry.uuid) && !injectedUuids.has(entry.uuid)) return false;
    if (entry.isCompactSummary) return false;
    if (compactTimestamp !== undefined) {
      const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      return entryTime >= compactTimestamp;
    }
    return true;
  });
}

function paginateEntries(
  entries: ClaudeSessionEntry[],
  offset: number,
  limit: number,
  compactInfo?: CompactInfo,
  injectedUuids?: Set<string>
): PaginatedSessionResult {
  const totalCount = entries.length;
  const endIndex = totalCount - offset;
  const startIndex = Math.max(0, endIndex - limit);
  const paginatedEntries = entries.slice(startIndex, endIndex);
  const hasMore = startIndex > 0;
  const nextOffset = offset + paginatedEntries.length;

  return { entries: paginatedEntries, totalCount, hasMore, nextOffset, compactInfo, injectedUuids };
}

export async function readSessionEntriesPaginated(
  workspacePath: string,
  sessionId: string,
  offset: number = 0,
  limit: number = 50
): Promise<PaginatedSessionResult> {
  const filePath = await getSessionFilePath(workspacePath, sessionId);

  try {
    const lines = await readSessionFileLines(filePath);
    const allEntries = parseAllSessionEntries(lines);

    log(`[SessionStorage] readSessionEntriesPaginated: allEntries=${allEntries.length}`);

    const activeUuids = getActiveBranchUuids(allEntries);
    log(`[SessionStorage] readSessionEntriesPaginated: activeUuids=${activeUuids.size}`);

    const injectedUuids = getInjectedMessageUuids(allEntries, activeUuids);
    log(`[SessionStorage] readSessionEntriesPaginated: injectedUuids=${injectedUuids.size}`);

    const { compactInfo, compactEntry } = extractCompactInfo(allEntries, activeUuids);
    log(`[SessionStorage] compact_boundary search: found=${!!compactEntry}, uuid=${compactEntry?.uuid?.slice(0, 8) ?? 'none'}`);

    if (compactInfo) {
      log(`[SessionStorage] compactInfo created: trigger=${compactInfo.trigger}, hasSummary=${!!compactInfo.summary}`);
    }

    const displayableEntries = filterDisplayableEntries(
      allEntries,
      activeUuids,
      injectedUuids,
      compactInfo?.timestamp
    );
    log(`[SessionStorage] postCompactEntries=${displayableEntries.length}`);

    return paginateEntries(displayableEntries, offset, limit, compactInfo, injectedUuids);
  } catch {
    return { entries: [], totalCount: 0, hasMore: false, nextOffset: 0 };
  }
}

export async function readLatestCompactSummary(
  workspacePath: string,
  sessionId: string,
  maxRetries = 3,
  retryDelayMs = 200
): Promise<string | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }

    try {
      const filePath = await getSessionFilePath(workspacePath, sessionId);
      const lines = await readSessionFileLines(filePath);
      const reversedLines = [...lines].reverse();

      for (let i = 0; i < Math.min(reversedLines.length, COMPACT_SUMMARY_SEARCH_DEPTH); i++) {
        try {
          const entry = JSON.parse(reversedLines[i]) as ClaudeSessionEntry;
          if (entry.isCompactSummary && entry.message?.content) {
            const summary = typeof entry.message.content === 'string'
              ? entry.message.content
              : '';
            if (summary) {
              log('[SessionStorage] readLatestCompactSummary: found summary at offset %d, length=%d', i, summary.length);
              return summary;
            }
          }
        } catch {
          continue;
        }
      }

      log('[SessionStorage] readLatestCompactSummary: no summary found (attempt %d)', attempt + 1);
    } catch (error) {
      log('[SessionStorage] readLatestCompactSummary error: %s', error);
    }
  }

  return null;
}
