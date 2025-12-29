import { extractSlashCommandDisplay } from '@shared/utils';
import type { JsonlContentBlock } from './types';
import { SDK_GENERATED_PREFIXES, COMMAND_HISTORY_PAGE_SIZE, MAX_COMMAND_HISTORY } from './types';
import { findUserTextBlock } from './parsing';
import { listSessions, readSessionEntries } from './reading';

function isSdkGeneratedMessage(text: string): boolean {
  return SDK_GENERATED_PREFIXES.some(prefix => text.startsWith(prefix));
}

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
