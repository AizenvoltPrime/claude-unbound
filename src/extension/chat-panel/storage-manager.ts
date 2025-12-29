import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  listSessions,
  getSessionDirSync,
  getSessionMetadata,
  type StoredSession,
} from "../session";
import type { ExtensionToWebviewMessage } from "../../shared/types";
import { SESSIONS_PAGE_SIZE, type PanelInstance } from "./types";

export interface StorageManagerConfig {
  workspacePath: string;
  postMessage: (panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage) => void;
  getPanels: () => Map<string, PanelInstance>;
}

export class StorageManager {
  private allSessionsCache: StoredSession[] | null = null;
  private sessionWatcher: vscode.FileSystemWatcher | null = null;
  private readonly workspacePath: string;
  private readonly postMessage: StorageManagerConfig["postMessage"];
  private readonly getPanels: StorageManagerConfig["getPanels"];

  constructor(config: StorageManagerConfig) {
    this.workspacePath = config.workspacePath;
    this.postMessage = config.postMessage;
    this.getPanels = config.getPanels;
  }

  async getStoredSessions(
    offset: number = 0,
    limit: number = SESSIONS_PAGE_SIZE
  ): Promise<{ sessions: StoredSession[]; hasMore: boolean; nextOffset: number }> {
    if (!this.allSessionsCache) {
      this.allSessionsCache = await listSessions(this.workspacePath);
    }

    const total = this.allSessionsCache.length;
    const sessions = this.allSessionsCache.slice(offset, offset + limit);
    const hasMore = offset + limit < total;
    const nextOffset = offset + sessions.length;

    return { sessions, hasMore, nextOffset };
  }

  invalidateSessionsCache(): void {
    this.allSessionsCache = null;
  }

  setupSessionWatcher(): void {
    if (this.sessionWatcher) return;

    const sessionDir = getSessionDirSync(this.workspacePath);

    if (!fs.existsSync(sessionDir)) {
      return;
    }

    const pattern = new vscode.RelativePattern(vscode.Uri.file(sessionDir), "*.jsonl");

    this.sessionWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.sessionWatcher.onDidCreate((uri) => this.handleSessionFileCreated(uri));
    this.sessionWatcher.onDidDelete((uri) => this.handleSessionFileDeleted(uri));
  }

  pushSessionsToAllPanels(): void {
    if (!this.allSessionsCache) return;

    const sessions = this.allSessionsCache.slice(0, SESSIONS_PAGE_SIZE);
    const hasMore = this.allSessionsCache.length > SESSIONS_PAGE_SIZE;
    const nextOffset = sessions.length;

    for (const [, instance] of this.getPanels()) {
      this.postMessage(instance.panel, {
        type: "storedSessions",
        sessions,
        hasMore,
        nextOffset,
        isFirstPage: true,
      });
    }
  }

  broadcastCommandHistoryEntry(entry: string): void {
    for (const [, instance] of this.getPanels()) {
      this.postMessage(instance.panel, {
        type: "commandHistoryPush",
        entry,
      });
    }
  }

  dispose(): void {
    this.sessionWatcher?.dispose();
  }

  private async handleSessionFileCreated(uri: vscode.Uri): Promise<void> {
    const filename = path.basename(uri.fsPath);
    if (!filename.endsWith(".jsonl") || filename.startsWith("agent-")) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));

    const sessionId = filename.replace(".jsonl", "");
    const metadata = await getSessionMetadata(this.workspacePath, sessionId);

    if (!metadata) {
      return;
    }

    if (!this.allSessionsCache) {
      this.allSessionsCache = await listSessions(this.workspacePath);
    } else {
      const existingIndex = this.allSessionsCache.findIndex((s) => s.id === sessionId);
      if (existingIndex >= 0) {
        this.allSessionsCache[existingIndex] = metadata;
      } else {
        this.allSessionsCache.push(metadata);
      }
      this.allSessionsCache.sort((a, b) => b.timestamp - a.timestamp);
    }

    this.pushSessionsToAllPanels();
  }

  private handleSessionFileDeleted(uri: vscode.Uri): void {
    const filename = path.basename(uri.fsPath);
    if (!filename.endsWith(".jsonl") || filename.startsWith("agent-")) {
      return;
    }

    const sessionId = filename.replace(".jsonl", "");

    if (this.allSessionsCache) {
      this.allSessionsCache = this.allSessionsCache.filter((s) => s.id !== sessionId);
    }

    this.pushSessionsToAllPanels();
  }
}
