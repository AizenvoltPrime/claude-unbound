/**
 * Shared types for communication between extension host and webview.
 * These mirror SDK types but are serializable for postMessage.
 */

// ============================================================================
// SDK-Related Types
// ============================================================================

// Model information from SDK supportedModels()
export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
}

// Slash command info from SDK supportedCommands()
export interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint: string;
}

// System initialization data from SDK 'system' message (subtype: 'init')
export interface SystemInitData {
  model: string;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  permissionMode: string;
  slashCommands: string[];
  apiKeySource: string;
  cwd: string;
  outputStyle?: string;
}

// MCP Server configuration types (matching SDK)
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpSseServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpSseServerConfig | McpHttpServerConfig;

// MCP Server status for UI display
export interface McpServerStatusInfo {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending';
  serverInfo?: {
    name: string;
    version: string;
  };
}

// Sandbox configuration (simplified for VS Code settings)
export interface SandboxConfig {
  enabled: boolean;
  autoAllowBashIfSandboxed?: boolean;
  allowUnsandboxedCommands?: boolean;
  networkAllowedDomains?: string[];
  networkAllowLocalBinding?: boolean;
}

// Permission modes from SDK
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

// Agent definition matching SDK's AgentDefinition type
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}

// ============================================================================
// Session & Settings Types
// ============================================================================

// Settings that can be changed mid-session via Query methods
export interface SessionSettings {
  model?: string;
  permissionMode: PermissionMode;
  maxThinkingTokens?: number | null;
}

// All extension settings (for settings panel)
export interface ExtensionSettings {
  model: string;
  maxTurns: number;
  maxBudgetUsd: number | null;
  maxThinkingTokens: number | null;
  betasEnabled: string[];
  permissionMode: PermissionMode;
  enableFileCheckpointing: boolean;
  sandbox: SandboxConfig;
}

// Checkpoint info for file rewind functionality
export interface MessageCheckpoint {
  messageId: string;
  userMessageId: string;
  timestamp: number;
  canRewind: boolean;
}

// Active subagent tracking
export interface ActiveSubagent {
  id: string;
  type: string;
  startTime: number;
}

// Compaction marker for UI
export interface CompactMarker {
  id: string;
  timestamp: number;
  trigger: 'manual' | 'auto';
  preTokens: number;
}

// Budget warning info
export interface BudgetWarningInfo {
  currentSpend: number;
  limit: number;
  percentUsed: number;
}

// ============================================================================
// Tool Input Types
// ============================================================================

// Tool input types for Edit/Write operations
export interface FileEditInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

export interface FileWriteInput {
  file_path: string;
  content: string;
}

// Content block types from SDK messages
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

/**
 * Tool call info for session history (simplified from live ToolCall).
 * Used when loading past sessions from JSONL.
 */
export interface HistoryToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;  // Tool result if available
}

/**
 * Message format for session history (loaded from JSONL).
 * Includes tool calls which are parsed from content blocks.
 */
export interface HistoryMessage {
  type: 'user' | 'assistant';
  content: string;
  thinking?: string;
  tools?: HistoryToolCall[];  // Tool calls for this message
}

// Serializable message types (subset of SDK types)
export interface AssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    content: ContentBlock[];
    model: string;
    stop_reason: string | null;
  };
  session_id: string;
}

export interface PartialMessage {
  type: 'partial';
  content: ContentBlock[];
  session_id: string;
  messageId: string | null;  // SDK message ID for proper association
  streamingThinking?: string;
  streamingText?: string;
  isThinking?: boolean;
}

export interface ResultMessage {
  type: 'result';
  session_id: string;
  is_done: boolean;
  total_cost_usd?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  num_turns?: number;
  context_window_size?: number;
}

// Messages from Webview → Extension
export type WebviewToExtensionMessage =
  | { type: 'log'; message: string }
  | { type: 'sendMessage'; content: string; agentId?: string }
  | { type: 'cancelSession' }
  | { type: 'resumeSession'; sessionId: string }
  | {
      type: 'approveEdit';
      approved: boolean;
      neverAskAgain?: boolean;
      customMessage?: string;
    }
  | { type: 'ready' }
  // New: Model and settings control
  | { type: 'requestModels' }
  | { type: 'setModel'; model: string }
  | { type: 'setMaxThinkingTokens'; tokens: number | null }
  | { type: 'setBudgetLimit'; budgetUsd: number | null }
  | { type: 'toggleBeta'; beta: string; enabled: boolean }
  | { type: 'setPermissionMode'; mode: PermissionMode }
  // New: File rewind
  | { type: 'rewindToMessage'; userMessageId: string }
  // New: Session control
  | { type: 'interrupt' }
  | { type: 'requestMcpStatus' }
  | { type: 'requestSupportedCommands' }
  | { type: 'openSettings' }
  // Session management
  | { type: 'renameSession'; sessionId: string; newName: string }
  // History pagination
  | { type: 'requestMoreHistory'; sessionId: string; offset: number }
  // Session list pagination
  | { type: 'requestMoreSessions'; offset: number };

// Messages from Extension → Webview
export type ExtensionToWebviewMessage =
  | { type: 'assistant'; data: AssistantMessage }
  | { type: 'partial'; data: PartialMessage }
  | { type: 'done'; data: ResultMessage }
  | { type: 'userMessage'; content: string }
  | { type: 'toolPending'; toolName: string; input: unknown }
  | { type: 'error'; message: string }
  | { type: 'sessionStarted'; sessionId: string }
  | { type: 'processing'; isProcessing: boolean }
  | { type: 'storedSessions'; sessions: StoredSession[]; hasMore?: boolean; nextOffset?: number; isFirstPage?: boolean }
  | { type: 'sessionCleared' }
  | { type: 'sessionRenamed'; sessionId: string; newName: string }
  | { type: 'notification'; message: string; notificationType: string }
  | { type: 'accountInfo'; data: AccountInfo }
  // New: Model and settings
  | { type: 'availableModels'; models: ModelInfo[] }
  | { type: 'systemInit'; data: SystemInitData }
  | { type: 'settingsUpdate'; settings: ExtensionSettings }
  | { type: 'supportedCommands'; commands: SlashCommandInfo[] }
  // New: Budget tracking
  | { type: 'budgetWarning'; currentSpend: number; limit: number; percentUsed: number }
  | { type: 'budgetExceeded'; finalSpend: number; limit: number }
  // New: MCP server status
  | { type: 'mcpServerStatus'; servers: McpServerStatusInfo[] }
  // New: File checkpointing
  | { type: 'checkpointInfo'; checkpoints: MessageCheckpoint[] }
  | { type: 'rewindComplete'; rewindToMessageId: string }
  | { type: 'rewindError'; message: string }
  // New: Tool lifecycle
  | { type: 'toolStreaming'; messageId: string; tool: { id: string; name: string; input: Record<string, unknown> } }
  | { type: 'toolCompleted'; toolUseId: string; toolName: string; result: string }
  | { type: 'toolFailed'; toolUseId: string; toolName: string; error: string; isInterrupt?: boolean }
  | { type: 'toolAbandoned'; toolUseId: string; toolName: string }  // Tool was streamed but never executed
  // New: Subagent lifecycle
  | { type: 'subagentStart'; agentId: string; agentType: string }
  | { type: 'subagentStop'; agentId: string }
  // New: Session lifecycle
  | { type: 'sessionStart'; source: 'startup' | 'resume' | 'clear' | 'compact' }
  | { type: 'sessionEnd'; reason: string }
  // New: Compaction
  | { type: 'preCompact'; trigger: 'manual' | 'auto' }
  | { type: 'compactBoundary'; preTokens: number; trigger: 'manual' | 'auto' }
  // New: User message replay (for resumed sessions)
  | { type: 'userReplay'; content: string; isSynthetic?: boolean }
  // New: Assistant message replay (for resumed sessions)
  | { type: 'assistantReplay'; content: string; thinking?: string; tools?: HistoryToolCall[] }
  // History pagination (includes tool calls for Edit/Write/etc.)
  | { type: 'historyChunk'; messages: HistoryMessage[]; hasMore: boolean; nextOffset: number }
  // Permission request for file operations and bash commands
  | {
      type: 'requestPermission';
      toolUseId: string;
      toolName: 'Write' | 'Edit' | 'Bash';
      toolInput: Record<string, unknown>;
      filePath?: string;
      originalContent?: string;
      proposedContent?: string;
      command?: string;
    };

// Chat message for UI rendering
export interface ChatMessage {
  id: string;  // Unique ID for Vue rendering (stable for message lifetime)
  sdkMessageId?: string;  // SDK message ID for identity matching (null until known)
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  timestamp: number;
  isPartial?: boolean;
  isThinkingPhase?: boolean; // True during thinking streaming phase (for animation)
  isReplay?: boolean;
  checkpointId?: string;
  thinking?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'awaiting_approval' | 'approved' | 'denied' | 'completed' | 'failed' | 'abandoned';
  result?: string;
  isError?: boolean;
  errorMessage?: string;
}

export interface SessionStats {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  numTurns: number;
  contextWindowSize: number;
}

export interface FileEntry {
  path: string;
  operation: 'read' | 'edit' | 'write' | 'create';
}

export interface StoredSession {
  id: string;
  timestamp: number;
  preview: string;
  slug?: string;
  customTitle?: string;  // User-set name via /rename
  messageCount?: number;
}

export interface AccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  apiKeySource?: string;
  model?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const AVAILABLE_AGENTS: AgentConfig[] = [
  { id: 'default', name: 'Default', description: 'General-purpose coding assistant', icon: '🤖' },
  { id: 'code-reviewer', name: 'Code Reviewer', description: 'Expert code review and analysis', icon: '🔍' },
  { id: 'explorer', name: 'Explorer', description: 'Fast codebase exploration', icon: '🗺️' },
  { id: 'planner', name: 'Planner', description: 'Software architecture planning', icon: '📋' },
];
