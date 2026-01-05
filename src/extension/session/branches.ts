import * as fs from 'fs';
import type { ClaudeSessionEntry } from './types';
import { INTERRUPT_MARKER } from './types';
import { getSessionDir, buildSessionFilePath } from './paths';
import { readSessionFileLines, parseSessionEntry, isDisplayableMessage } from './parsing';
import { log } from '../logger';

export function getActiveBranchUuids(allEntries: ClaudeSessionEntry[], customLeaf?: string): Set<string> {
  const entryByUuid = new Map<string, ClaudeSessionEntry>();
  for (const entry of allEntries) {
    if (entry.uuid) {
      entryByUuid.set(entry.uuid, entry);
    }
  }

  let leafUuid: string | null = null;
  if (customLeaf && entryByUuid.has(customLeaf)) {
    leafUuid = customLeaf;
  } else {
    for (let i = allEntries.length - 1; i >= 0; i--) {
      const entry = allEntries[i];
      if ((entry.type === 'user' || entry.type === 'assistant') && entry.uuid) {
        leafUuid = entry.uuid;
        break;
      }
    }
  }

  if (!leafUuid) {
    return new Set();
  }

  const activeUuids = new Set<string>();
  let currentUuid: string | null = leafUuid;

  while (currentUuid) {
    activeUuids.add(currentUuid);
    const entry = entryByUuid.get(currentUuid);
    if (!entry) break;
    currentUuid = entry.parentUuid ?? null;
  }

  return activeUuids;
}

export function getInjectedMessageUuids(allEntries: ClaudeSessionEntry[], activeUuids: Set<string>): Set<string> {
  const injectedUuids = new Set<string>();
  for (const entry of allEntries) {
    if (entry.type === 'user' && entry.uuid && !activeUuids.has(entry.uuid)) {
      if (entry.isInjected && entry.parentUuid && activeUuids.has(entry.parentUuid)) {
        injectedUuids.add(entry.uuid);
      }
    }
  }
  return injectedUuids;
}

export function extractActiveBranch(allEntries: ClaudeSessionEntry[]): ClaudeSessionEntry[] {
  const activeUuids = getActiveBranchUuids(allEntries);
  return allEntries.filter(entry =>
    isDisplayableMessage(entry) && entry.uuid && activeUuids.has(entry.uuid)
  );
}

export function findLastQueueOperationIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const entry = parseSessionEntry(line);
      if (entry.type === 'queue-operation' && entry.operation === 'dequeue') {
        return i;
      }
    } catch {
      continue;
    }
  }
  return -1;
}

export async function getLastMessageUuid(workspacePath: string, sessionId: string): Promise<string | null> {
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = buildSessionFilePath(sessionDir, sessionId);

  try {
    const lines = await readSessionFileLines(filePath);

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

export async function getMessageParentUuid(
  workspacePath: string,
  sessionId: string,
  messageUuid: string
): Promise<string | null> {
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = buildSessionFilePath(sessionDir, sessionId);

  try {
    const lines = await readSessionFileLines(filePath);

    for (const line of lines) {
      try {
        const entry = parseSessionEntry(line);
        if (entry.uuid === messageUuid) {
          return entry.parentUuid ?? null;
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
  sessionId: string,
  matchContent?: string
): Promise<{ uuid: string; content: string } | null> {
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = buildSessionFilePath(sessionDir, sessionId);

  try {
    const lines = await readSessionFileLines(filePath);

    // When searching by content, search entire file since the message may be
    // written before any queue operations. Content matching + excludeUuid
    // is sufficient to find the correct message.
    // Queue op filtering only applies when finding "last user message" without content.
    const startIndex = matchContent !== undefined
      ? 0
      : findLastQueueOperationIndex(lines) + 1;

    let lastUserMessage: { uuid: string; content: string } | null = null;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        const entry = parseSessionEntry(line);

        if (entry.type === 'user' && entry.uuid) {
          const rawContent = entry.message?.content;
          const messageContent = typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent
                  .filter((c): c is { type: 'text'; text: string } =>
                    typeof c === 'object' && c !== null && 'type' in c && c.type === 'text')
                  .map(c => c.text)
                  .join('\n')
              : '';

          if (messageContent === INTERRUPT_MARKER) {
            continue;
          }

          const contentMatches = matchContent === undefined || messageContent.trim() === matchContent.trim();
          if (contentMatches) {
            lastUserMessage = { uuid: entry.uuid, content: messageContent };
          }
        }
      } catch {
        continue;
      }
    }

    return lastUserMessage;
  } catch {
    return null;
  }
}

export async function findLastMessageInCurrentTurn(
  workspacePath: string,
  sessionId: string
): Promise<string | null> {
  const sessionDir = await getSessionDir(workspacePath);
  const filePath = buildSessionFilePath(sessionDir, sessionId);

  try {
    const lines = await readSessionFileLines(filePath);
    const lastQueueOpIndex = findLastQueueOperationIndex(lines);

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
