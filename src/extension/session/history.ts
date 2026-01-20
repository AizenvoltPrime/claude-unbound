import { extractSlashCommandDisplay } from '@shared/utils';
import type { JsonlContentBlock, StoredSession } from './types';
import { SDK_GENERATED_PREFIXES, MAX_COMMAND_HISTORY } from './types';
import { findUserTextBlock } from './parsing';
import { readSessionEntries } from './reading';

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

async function extractPromptsFromSession(
  workspacePath: string,
  sessionId: string
): Promise<string[]> {
  const entries = await readSessionEntries(workspacePath, sessionId);
  const userPrompts: string[] = [];

  for (const entry of entries) {
    if (entry.type !== 'user') continue;
    if (entry.userType !== 'external') continue;
    if (entry.isMeta || entry.isInterrupt) continue;
    if (entry.toolUseResult) continue;
    if (!entry.message?.content) continue;

    const text = extractUserMessageText(entry.message.content);
    if (!text || text.trim().length === 0) continue;
    if (isSdkGeneratedMessage(text)) continue;

    userPrompts.push(text.trim());
  }

  return userPrompts.reverse();
}

export async function extractCommandHistory(
  workspacePath: string,
  sessions: StoredSession[]
): Promise<{ allHistory: string[] }> {
  const sessionsToProcess = sessions.slice(0, 20);

  const sessionPrompts = await Promise.all(
    sessionsToProcess.map(session => extractPromptsFromSession(workspacePath, session.id))
  );

  const seen = new Set<string>();
  const allHistory: string[] = [];

  for (const prompts of sessionPrompts) {
    for (const text of prompts) {
      if (allHistory.length >= MAX_COMMAND_HISTORY) break;
      if (seen.has(text)) continue;

      seen.add(text);
      allHistory.push(text);
    }
    if (allHistory.length >= MAX_COMMAND_HISTORY) break;
  }

  return { allHistory };
}
