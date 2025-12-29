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

// Custom slash command from .claude/commands/ files
export interface CustomSlashCommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
  filePath: string;
  source: "project" | "user";
  namespace?: string;
}

// Built-in slash command (hardcoded in extension)
export interface BuiltinSlashCommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
  source: "builtin";
}

// Union type for autocomplete - both custom and built-in commands
export type SlashCommandItem = CustomSlashCommandInfo | BuiltinSlashCommandInfo;

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
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpSseServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpSseServerConfig | McpHttpServerConfig;

// MCP Server status for UI display
export interface McpServerStatusInfo {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending";
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
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

// Agent definition matching SDK's AgentDefinition type
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: "sonnet" | "opus" | "haiku" | "inherit";
}

// Queued message with unique ID for tracking (message queue injection)
export interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
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
  permissionMode: PermissionMode;           // Per-panel mode (ephemeral)
  defaultPermissionMode: PermissionMode;    // Global default for new panels (persisted)
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

// Result from Task tool completion (parsed from tool_response JSON)
export interface SubagentResult {
  content: string;
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
  sdkAgentId?: string;
}

// Full subagent state for UI rendering
export interface SubagentState {
  id: string;
  agentType: string;
  description: string;
  prompt: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startTime: number;
  endTime?: number;
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  result?: SubagentResult;
  model?: string;
  sdkAgentId?: string;
}

// Todo item from TodoWrite tool
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

// Compaction marker for UI
export interface CompactMarker {
  id: string;
  timestamp: number;
  trigger: "manual" | "auto";
  preTokens: number;
  postTokens?: number;
  summary?: string;
}

// Context usage breakdown for /context command
export interface ContextUsageData {
  model: string;
  totalTokens: number;
  maxTokens: number;
  breakdown: {
    systemPrompt: number;
    systemTools: number;
    customAgents: number;
    memoryFiles: number;
    messages: number;
    freeSpace: number;
  };
  details: {
    memoryFiles: { name: string; tokens: number }[];
    skills: { name: string; tokens: number }[];
    customAgents: { name: string; tokens: number }[];
  };
}

// Rewind history item for /rewind browser
export interface RewindHistoryItem {
  messageId: string;
  content: string;
  timestamp: number;
  filesAffected: number;
  linesChanged?: { added: number; removed: number };
}

// Rewind option from confirmation modal
export type RewindOption = 'code-and-conversation' | 'conversation-only' | 'code-only' | 'cancel';

// Budget warning info
export interface BudgetWarningInfo {
  currentSpend: number;
  limit: number;
  percentUsed: number;
}

// Permission request info for tool approval queue
export interface PendingPermissionInfo {
  toolUseId: string;
  toolName: string;
  filePath?: string;
  originalContent?: string;
  proposedContent?: string;
  command?: string;
  parentToolUseId?: string | null;
  agentDescription?: string;
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
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: "thinking";
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
  result?: string; // Tool result if available
  agentToolCalls?: HistoryToolCall[]; // For Task tools: nested tool calls from agent JSONL
  agentModel?: string; // For Task tools: the model used by the subagent
  sdkAgentId?: string; // For Task tools: SDK's agent ID for JSONL file access
}

/**
 * Message format for session history (loaded from JSONL).
 * Includes tool calls which are parsed from content blocks.
 */
export interface HistoryMessage {
  type: "user" | "assistant" | "error";
  content: string;
  thinking?: string;
  tools?: HistoryToolCall[]; // Tool calls for this message
  sdkMessageId?: string; // SDK's message UUID for rewind correlation
  isInjected?: boolean; // True for messages sent mid-stream via SDK injection
}

// Serializable message types (subset of SDK types)
export interface AssistantMessage {
  type: "assistant";
  message: {
    id: string;
    role: "assistant";
    content: ContentBlock[];
    model: string;
    stop_reason: string | null;
  };
  session_id: string;
}

export interface PartialMessage {
  type: "partial";
  content: ContentBlock[];
  session_id: string;
  messageId: string | null; // SDK message ID for proper association
  streamingThinking?: string;
  streamingText?: string;
  isThinking?: boolean;
  thinkingDuration?: number; // Seconds spent in thinking phase
}

export interface ResultMessage {
  type: "result";
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
  | { type: "log"; message: string }
  | { type: "sendMessage"; content: string; agentId?: string }
  | { type: "cancelSession" }
  | { type: "resumeSession"; sessionId: string }
  | {
      type: "approveEdit";
      toolUseId: string;
      approved: boolean;
      customMessage?: string;
    }
  | { type: "ready" }
  // New: Model and settings control
  | { type: "requestModels" }
  | { type: "setModel"; model: string }
  | { type: "setMaxThinkingTokens"; tokens: number | null }
  | { type: "setBudgetLimit"; budgetUsd: number | null }
  | { type: "toggleBeta"; beta: string; enabled: boolean }
  | { type: "setPermissionMode"; mode: PermissionMode }
  | { type: "setDefaultPermissionMode"; mode: PermissionMode }
  // New: File rewind
  | { type: "rewindToMessage"; userMessageId: string; option: RewindOption }
  | { type: "requestRewindHistory" }
  // New: Session control
  | { type: "interrupt" }
  | { type: "requestMcpStatus" }
  | { type: "requestSupportedCommands" }
  | { type: "openSettings" }
  // Session management
  | { type: "renameSession"; sessionId: string; newName: string }
  | { type: "deleteSession"; sessionId: string }
  | { type: "openSessionLog" }
  | { type: "openAgentLog"; agentId: string }
  // History pagination
  | { type: "requestMoreHistory"; sessionId: string; offset: number }
  // Session list pagination
  | { type: "requestMoreSessions"; offset: number }
  // Command history navigation (arrow up/down)
  | { type: "requestCommandHistory"; offset?: number }
  // Workspace file listing for @ mentions
  | { type: "requestWorkspaceFiles" }
  // Open file in editor (from clickable file paths)
  | { type: "openFile"; filePath: string; line?: number }
  // Custom slash commands from .claude/commands/
  | { type: "requestCustomSlashCommands" }
  // Message queue injection
  | { type: "queueMessage"; content: string }
  | { type: "cancelQueuedMessage"; messageId: string };

// Messages from Extension → Webview
export type ExtensionToWebviewMessage =
  | { type: "assistant"; data: AssistantMessage; parentToolUseId?: string | null }
  | { type: "partial"; data: PartialMessage; parentToolUseId?: string | null }
  | { type: "done"; data: ResultMessage }
  | { type: "userMessage"; content: string }
  | { type: "userMessageIdAssigned"; sdkMessageId: string }
  | { type: "toolPending"; toolName: string; input: unknown }
  | { type: "error"; message: string }
  | { type: "sessionStarted"; sessionId: string }
  | { type: "processing"; isProcessing: boolean }
  | { type: "storedSessions"; sessions: StoredSession[]; hasMore?: boolean; nextOffset?: number; isFirstPage?: boolean }
  | { type: "sessionCleared" }
  | { type: "sessionRenamed"; sessionId: string; newName: string }
  | { type: "sessionDeleted"; sessionId: string }
  | { type: "notification"; message: string; notificationType: string }
  | { type: "accountInfo"; data: AccountInfo }
  // New: Model and settings
  | { type: "availableModels"; models: ModelInfo[] }
  | { type: "systemInit"; data: SystemInitData }
  | { type: "settingsUpdate"; settings: ExtensionSettings }
  | { type: "supportedCommands"; commands: SlashCommandInfo[] }
  // New: Budget tracking
  | { type: "budgetWarning"; currentSpend: number; limit: number; percentUsed: number }
  | { type: "budgetExceeded"; finalSpend: number; limit: number }
  // New: MCP server status
  | { type: "mcpServerStatus"; servers: McpServerStatusInfo[] }
  // New: File checkpointing
  | { type: "checkpointInfo"; checkpoints: MessageCheckpoint[] }
  | { type: "rewindComplete"; rewindToMessageId: string; option: RewindOption; fileRewindWarning?: string }
  | { type: "rewindError"; message: string }
  // New: Tool lifecycle
  | { type: "toolStreaming"; messageId: string; tool: { id: string; name: string; input: Record<string, unknown> }; parentToolUseId?: string | null }
  | { type: "toolCompleted"; toolUseId: string; toolName: string; result: string; parentToolUseId?: string | null }
  | { type: "toolFailed"; toolUseId: string; toolName: string; error: string; isInterrupt?: boolean; parentToolUseId?: string | null }
  | { type: "toolAbandoned"; toolUseId: string; toolName: string; parentToolUseId?: string | null }
  // New: Subagent lifecycle
  | { type: "subagentStart"; agentId: string; agentType: string }
  | { type: "subagentStop"; agentId: string }
  | { type: "sessionCancelled" }
  // New: Session lifecycle
  | { type: "sessionStart"; source: "startup" | "resume" | "clear" | "compact" }
  | { type: "sessionEnd"; reason: string }
  // New: Compaction
  | { type: "preCompact"; trigger: "manual" | "auto" }
  | { type: "compactBoundary"; preTokens: number; postTokens?: number; trigger: "manual" | "auto"; summary?: string; timestamp?: number; isHistorical?: boolean }
  | { type: "compactSummary"; summary: string }
  // New: Todos from TodoWrite tool
  | { type: "todosUpdate"; todos: TodoItem[] }
  // New: Context usage for /context command
  | { type: "contextUsage"; data: ContextUsageData }
  // New: Rewind history for /rewind browser
  | { type: "rewindHistory"; prompts: RewindHistoryItem[] }
  // New: User message replay (for resumed sessions)
  | { type: "userReplay"; content: string; isSynthetic?: boolean; sdkMessageId?: string; isInjected?: boolean }
  // New: Assistant message replay (for resumed sessions)
  | { type: "assistantReplay"; content: string; thinking?: string; tools?: HistoryToolCall[] }
  // New: Error message replay (for interrupted sessions loaded from history)
  | { type: "errorReplay"; content: string }
  // History pagination (includes tool calls for Edit/Write/etc.)
  | { type: "historyChunk"; messages: HistoryMessage[]; hasMore: boolean; nextOffset: number }
  // Command history (for arrow up/down navigation)
  | { type: "commandHistory"; history: string[]; hasMore: boolean }
  // Broadcast new command to all panels
  | { type: "commandHistoryPush"; entry: string }
  // Panel visibility changed (for auto-focus)
  | { type: "panelFocused" }
  // Workspace file listing response for @ mentions
  | { type: "workspaceFiles"; files: WorkspaceFileInfo[] }
  // Permission request for file operations and bash commands
  | {
      type: "requestPermission";
      toolUseId: string;
      toolName: "Write" | "Edit" | "Bash";
      toolInput: Record<string, unknown>;
      filePath?: string;
      originalContent?: string;
      proposedContent?: string;
      command?: string;
      parentToolUseId?: string | null;
    }
  // Custom slash commands from .claude/commands/
  | { type: "customSlashCommands"; commands: SlashCommandItem[] }
  // Message queue injection
  | { type: "messageQueued"; message: QueuedMessage }
  | { type: "queueProcessed"; messageId: string }
  | { type: "queueCancelled"; messageId: string };

// Chat message for UI rendering
export interface ChatMessage {
  id: string; // Unique ID for Vue rendering (stable for message lifetime)
  sdkMessageId?: string; // SDK message ID for identity matching (null until known)
  role: "user" | "assistant" | "error";
  content: string;
  toolCalls?: ToolCall[];
  timestamp: number;
  isPartial?: boolean;
  isThinkingPhase?: boolean; // True during thinking streaming phase (for animation)
  isReplay?: boolean;
  checkpointId?: string;
  thinking?: string;
  thinkingDuration?: number; // Seconds spent in thinking phase
  parentToolUseId?: string | null; // Links to parent Task tool if from subagent
  isQueued?: boolean; // True if message is queued, waiting to be processed
  isInjected?: boolean; // True for messages sent mid-stream via SDK injection
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "pending" | "running" | "awaiting_approval" | "approved" | "denied" | "completed" | "failed" | "abandoned";
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
  operation: "read" | "edit" | "write" | "create";
}

export interface WorkspaceFileInfo {
  relativePath: string;
  isDirectory: boolean;
}

export interface StoredSession {
  id: string;
  timestamp: number;
  preview: string;
  slug?: string;
  customTitle?: string; // User-set name via /rename
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
  { id: "default", name: "Default", description: "General-purpose coding assistant", icon: "🤖" },
  { id: "code-reviewer", name: "Code Reviewer", description: "Expert code review and analysis", icon: "🔍" },
  { id: "explorer", name: "Explorer", description: "Fast codebase exploration", icon: "🗺️" },
  { id: "planner", name: "Planner", description: "Software architecture planning", icon: "📋" },
];
