import type * as vscode from "vscode";
import type { ClaudeSession } from "../claude-session";
import type { PermissionHandler } from "../PermissionHandler";
import type { IdeContextManager } from "./ide-context-manager";
import type {
  McpServerConfig,
  HistoryMessage,
  RewindHistoryItem,
  StoredSession,
} from "../../shared/types";

export const SESSIONS_PAGE_SIZE = 20;
export const HISTORY_PAGE_SIZE = 30;

export interface PanelInstance {
  panel: vscode.WebviewPanel;
  session: ClaudeSession;
  permissionHandler: PermissionHandler;
  ideContextManager: IdeContextManager;
  disposables: vscode.Disposable[];
}

export type { StoredSession, HistoryMessage, RewindHistoryItem, McpServerConfig };
