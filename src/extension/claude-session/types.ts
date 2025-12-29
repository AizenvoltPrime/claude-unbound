import type { PermissionHandler } from '../PermissionHandler';
import type {
  ExtensionToWebviewMessage,
  AgentDefinition,
  McpServerConfig,
} from '../../shared/types';

/** Type for the Query object returned by the SDK */
export type Query = ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;

/** Options for creating a ClaudeSession */
export interface SessionOptions {
  cwd: string;
  permissionHandler: PermissionHandler;
  onMessage: (message: ExtensionToWebviewMessage) => void;
  onSessionIdChange?: (sessionId: string | null) => void;
  mcpServers?: Record<string, McpServerConfig>;
}

/** Callbacks for inter-manager communication */
export interface MessageCallbacks {
  onMessage: (message: ExtensionToWebviewMessage) => void;
  onSessionIdChange?: (sessionId: string | null) => void;
}

/** Accumulated assistant message before flush */
export interface PendingAssistantMessage {
  id: string;
  model: string;
  stopReason: string | null;
  content: import('../../shared/types').ContentBlock[];
  sessionId: string;
  parentToolUseId: string | null;
}

/** Current streaming content accumulator */
export interface StreamingContent {
  messageId: string | null;
  thinking: string;
  text: string;
  isThinking: boolean;
  hasStreamedTools: boolean;
  thinkingStartTime: number | null;
  thinkingDuration: number | null;
  parentToolUseId: string | null;
}

/** Info about a streamed tool for correlation */
export interface StreamedToolInfo {
  toolName: string;
  messageId: string;
  parentToolUseId: string | null;
}

/** Controller for streaming input mode - allows sending messages to an active query */
export interface StreamingInputController {
  sendMessage: (content: string) => void;
  close: () => void;
}

/** Tool permission result from canUseTool callback */
export type ToolPermissionResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/** Rewind option for file/conversation restoration */
export type RewindOption = 'code-and-conversation' | 'conversation-only' | 'code-only';

/** Agent definitions using proper SDK agents option */
export const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  'code-reviewer': {
    description: 'Expert code review and analysis',
    prompt: 'You are an expert code reviewer. Focus on code quality, potential bugs, security issues, and best practices. Provide constructive feedback with specific suggestions. Do NOT modify files unless explicitly asked.',
    tools: ['Read', 'Glob', 'Grep', 'LSP'],
    model: 'inherit',
  },
  'explorer': {
    description: 'Fast codebase exploration',
    prompt: 'You are a fast codebase explorer. Focus on quickly finding files, understanding project structure, and answering questions about how code is organized. Prefer using Glob and Grep tools for efficiency.',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'LSP'],
    model: 'haiku',
  },
  'planner': {
    description: 'Software architecture planning',
    prompt: 'You are a software architect. Focus on designing implementation plans, identifying critical files, considering architectural trade-offs, and breaking down tasks into clear steps. Do NOT modify files - only analyze and plan.',
    tools: ['Read', 'Glob', 'Grep', 'LSP'],
    model: 'opus',
  },
};

/** Creates fresh streaming content state */
export function createEmptyStreamingContent(): StreamingContent {
  return {
    messageId: null,
    thinking: '',
    text: '',
    isThinking: false,
    hasStreamedTools: false,
    thinkingStartTime: null,
    thinkingDuration: null,
    parentToolUseId: null,
  };
}
