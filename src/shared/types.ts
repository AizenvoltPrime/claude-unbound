/**
 * Shared types for communication between extension host and webview.
 * These mirror SDK types but are serializable for postMessage.
 */

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

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

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
}

export interface ResultMessage {
  type: 'result';
  session_id: string;
  is_done: boolean;
  total_cost_usd?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  num_turns?: number;
}

// Messages from Webview → Extension
export type WebviewToExtensionMessage =
  | { type: 'sendMessage'; content: string }
  | { type: 'cancelSession' }
  | { type: 'resumeSession'; sessionId: string }
  | { type: 'approveEdit'; approved: boolean }
  | { type: 'ready' };

// Messages from Extension → Webview
export type ExtensionToWebviewMessage =
  | { type: 'assistant'; data: AssistantMessage }
  | { type: 'partial'; data: PartialMessage }
  | { type: 'done'; data: ResultMessage }
  | { type: 'userMessage'; content: string }
  | { type: 'toolPending'; toolName: string; input: unknown }
  | { type: 'error'; message: string }
  | { type: 'sessionStarted'; sessionId: string }
  | { type: 'processing'; isProcessing: boolean };

// Chat message for UI rendering
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  timestamp: number;
  isPartial?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'completed';
  result?: string;
  isError?: boolean;
}
