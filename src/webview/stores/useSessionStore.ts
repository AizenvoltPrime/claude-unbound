import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type {
  StoredSession,
  FileEntry,
  CompactMarker,
  SessionStats,
  TodoItem,
} from '@shared/types';

const DEFAULT_SESSION_STATS: SessionStats = {
  totalCostUsd: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  numTurns: 0,
  contextWindowSize: 200000,
};

export const useSessionStore = defineStore('session', () => {
  const currentSessionId = ref<string | null>(null);
  const selectedSessionId = ref<string | null>(null);
  const currentResumedSessionId = ref<string | null>(null);
  const storedSessions = ref<StoredSession[]>([]);

  const hasMoreSessions = ref(false);
  const nextSessionsOffset = ref(0);
  const loadingMoreSessions = ref(false);

  const hasMoreHistory = ref(false);
  const nextHistoryOffset = ref(0);
  const loadingMoreHistory = ref(false);

  const accessedFiles = ref<Record<string, FileEntry>>({});
  const checkpointMessages = ref<Set<string>>(new Set());
  const compactMarkers = ref<CompactMarker[]>([]);
  const sessionStats = ref<SessionStats>({ ...DEFAULT_SESSION_STATS });
  const currentTodos = ref<TodoItem[]>([]);

  const selectedSession = computed(() => {
    if (!selectedSessionId.value) return null;
    return storedSessions.value.find(s => s.id === selectedSessionId.value) ?? null;
  });

  const lastAccessedFile = computed(() => {
    const files = Object.values(accessedFiles.value);
    if (files.length === 0) return undefined;
    return files[files.length - 1].path;
  });

  function setCurrentSession(id: string | null) {
    currentSessionId.value = id;
  }

  function setSelectedSession(id: string | null) {
    selectedSessionId.value = id;
  }

  function setResumedSession(id: string | null) {
    currentResumedSessionId.value = id;
  }

  function updateStoredSessions(
    sessions: StoredSession[],
    isFirstPage: boolean,
    hasMore: boolean,
    nextOffset: number
  ) {
    if (isFirstPage) {
      storedSessions.value = sessions;
    } else {
      storedSessions.value = [...storedSessions.value, ...sessions];
    }
    hasMoreSessions.value = hasMore;
    nextSessionsOffset.value = nextOffset;
    loadingMoreSessions.value = false;
  }

  function setLoadingMoreSessions(loading: boolean) {
    loadingMoreSessions.value = loading;
  }

  function updateHistoryPagination(hasMore: boolean, nextOffset: number) {
    hasMoreHistory.value = hasMore;
    nextHistoryOffset.value = nextOffset;
    loadingMoreHistory.value = false;
  }

  function setLoadingMoreHistory(loading: boolean) {
    loadingMoreHistory.value = loading;
  }

  function trackFileAccess(toolName: string, input: Record<string, unknown>) {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return;

    let operation: FileEntry['operation'];
    switch (toolName) {
      case 'Read':
        operation = 'read';
        break;
      case 'Edit':
        operation = 'edit';
        break;
      case 'Write':
        operation = filePath in accessedFiles.value ? 'write' : 'create';
        break;
      default:
        return;
    }

    accessedFiles.value = {
      ...accessedFiles.value,
      [filePath]: { path: filePath, operation },
    };
  }

  function setCheckpointMessages(messageIds: string[]) {
    checkpointMessages.value = new Set(messageIds);
  }

  function addCompactMarker(trigger: 'manual' | 'auto', preTokens: number, postTokens?: number, summary?: string, timestamp?: number, messageCutoffTimestamp?: number) {
    const ts = timestamp ?? Date.now();
    const marker: CompactMarker = {
      id: `compact-${ts}`,
      timestamp: ts,
      trigger,
      preTokens,
      postTokens,
      summary,
      messageCutoffTimestamp,
    };
    compactMarkers.value = [...compactMarkers.value, marker];
  }

  function updateLastCompactMarkerSummary(summary: string) {
    if (compactMarkers.value.length === 0) return;
    const markers = [...compactMarkers.value];
    const lastIndex = markers.length - 1;
    markers[lastIndex] = { ...markers[lastIndex], summary };
    compactMarkers.value = markers;
  }

  function clearCompactMarkers() {
    compactMarkers.value = [];
  }

  function updateTodos(todos: TodoItem[]) {
    currentTodos.value = todos;
  }

  function updateStats(updates: Partial<SessionStats>) {
    sessionStats.value = { ...sessionStats.value, ...updates };
  }

  function clearSessionData() {
    accessedFiles.value = {};
    checkpointMessages.value = new Set();
    compactMarkers.value = [];
    sessionStats.value = { ...DEFAULT_SESSION_STATS };
    currentTodos.value = [];
    hasMoreHistory.value = false;
    nextHistoryOffset.value = 0;
    loadingMoreHistory.value = false;
  }

  function $reset() {
    currentSessionId.value = null;
    selectedSessionId.value = null;
    currentResumedSessionId.value = null;
    storedSessions.value = [];
    hasMoreSessions.value = false;
    nextSessionsOffset.value = 0;
    loadingMoreSessions.value = false;
    hasMoreHistory.value = false;
    nextHistoryOffset.value = 0;
    loadingMoreHistory.value = false;
    accessedFiles.value = {};
    checkpointMessages.value = new Set();
    compactMarkers.value = [];
    sessionStats.value = { ...DEFAULT_SESSION_STATS };
    currentTodos.value = [];
  }

  return {
    currentSessionId,
    selectedSessionId,
    currentResumedSessionId,
    storedSessions,
    hasMoreSessions,
    nextSessionsOffset,
    loadingMoreSessions,
    hasMoreHistory,
    nextHistoryOffset,
    loadingMoreHistory,
    accessedFiles,
    checkpointMessages,
    compactMarkers,
    sessionStats,
    currentTodos,
    selectedSession,
    lastAccessedFile,
    setCurrentSession,
    setSelectedSession,
    setResumedSession,
    updateStoredSessions,
    setLoadingMoreSessions,
    updateHistoryPagination,
    setLoadingMoreHistory,
    trackFileAccess,
    setCheckpointMessages,
    addCompactMarker,
    updateLastCompactMarkerSummary,
    clearCompactMarkers,
    updateTodos,
    updateStats,
    clearSessionData,
    $reset,
  };
});
