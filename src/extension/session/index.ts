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
} from './parsing';

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
  renameSession,
  deleteSession,
} from './writing';

export {
  getActiveBranchUuids,
  extractActiveBranch,
  getLastMessageUuid,
  getMessageParentUuid,
  findUserMessageInCurrentTurn,
  findLastMessageInCurrentTurn,
} from './branches';

export {
  extractCommandHistory,
} from './history';
