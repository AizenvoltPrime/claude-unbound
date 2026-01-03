export type {
  JsonlContentBlock,
  ClaudeSessionEntry,
  StoredSession,
  AgentToolCall,
  AgentData,
  ExtractedSessionStats,
  CompactInfo,
  PaginatedSessionResult,
  PersistUserMessageOptions,
  PersistPartialAssistantOptions,
  PersistInterruptOptions,
} from './types';

export {
  isValidSessionId,
  getClaudeProjectsDir,
  encodeProjectPath,
  getSessionDir,
  getSessionDirSync,
  ensureSessionDir,
  getSessionFilePath,
  getAgentFilePath,
} from './paths';

export {
  findUserTextBlock,
  findUserImageBlocks,
} from './parsing';

export type { RawImageBlock } from './parsing';

export {
  listSessions,
  getSessionMetadata,
  sessionExists,
  readSessionEntries,
  readActiveBranchEntries,
  readAgentData,
  extractSessionStats,
  readSessionEntriesPaginated,
  readLatestCompactSummary,
} from './reading';

export {
  initializeSession,
  persistUserMessage,
  persistPartialAssistant,
  persistInterruptMarker,
  persistQueuedMessage,
  persistInjectedMessage,
  renameSession,
  deleteSession,
} from './writing';

export type { PersistInjectedMessageOptions } from './writing';

export {
  getActiveBranchUuids,
  getInjectedMessageUuids,
  extractActiveBranch,
  getLastMessageUuid,
  getMessageParentUuid,
  findUserMessageInCurrentTurn,
  findLastMessageInCurrentTurn,
} from './branches';

export {
  extractCommandHistory,
} from './history';
