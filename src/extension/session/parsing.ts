import * as fs from 'fs';
import { stripControlChars, extractSlashCommandDisplay } from '@shared/utils';
import type { ClaudeSessionEntry, JsonlContentBlock } from './types';
import { isContentBlockArray } from './types';

export function parseSessionEntry(line: string): ClaudeSessionEntry {
  const entry: ClaudeSessionEntry = JSON.parse(line);

  if (entry.message?.content) {
    if (typeof entry.message.content === 'string') {
      entry.message.content = stripControlChars(entry.message.content);
    } else if (isContentBlockArray(entry.message.content)) {
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

export async function readSessionFileLines(filePath: string): Promise<string[]> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return content.trim().split('\n').filter(line => line.trim());
}

export function parseSessionLines<T>(
  lines: string[],
  processor: (entry: ClaudeSessionEntry) => T | null
): T[] {
  const results: T[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = parseSessionEntry(line);
      const result = processor(entry);
      if (result !== null) results.push(result);
    } catch {
      continue;
    }
  }
  return results;
}

export function parseAllSessionEntries(lines: string[]): ClaudeSessionEntry[] {
  return parseSessionLines(lines, entry => entry);
}

export function findUserTextBlock(
  content: JsonlContentBlock[]
): { type: 'text'; text: string } | undefined {
  return content.find(
    (b): b is { type: 'text'; text: string } =>
      b.type === 'text' && typeof b.text === 'string' && !b.text.startsWith('<ide_')
  );
}

export function isDisplayableMessage(entry: ClaudeSessionEntry): boolean {
  if (entry.type === 'user' && entry.message && !entry.isMeta) {
    return true;
  }
  if (entry.type === 'assistant' && entry.message) {
    return true;
  }
  return false;
}

export function extractPreviewText(content: string): string {
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

export function extractTextFromSlashCommand(text: string): string {
  if (text.startsWith('/')) {
    const spaceIndex = text.indexOf(' ');
    if (spaceIndex > 0) {
      return text.slice(spaceIndex + 1);
    }
  }
  return text;
}
