import * as vscode from 'vscode';
import { DiffManager } from './DiffManager';
import type { FileEditInput, FileWriteInput, ExtensionToWebviewMessage, PermissionMode } from '../shared/types';

export interface PermissionResult {
  behavior: 'allow' | 'deny';
  message?: string;
  updatedInput?: unknown;
}

export interface CanUseToolContext {
  signal: AbortSignal;
  toolUseID: string | null;
  agentID?: string;
  parentToolUseId?: string | null;
}

interface ApprovalResult {
  approved: boolean;
  customMessage?: string;
}

interface PendingApproval {
  resolve: (result: ApprovalResult) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  diffId?: string;
}

export class PermissionHandler {
  private diffManager: DiffManager;
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private postMessageToWebview: ((msg: ExtensionToWebviewMessage) => void) | null = null;
  private _permissionMode: PermissionMode = 'default';

  constructor(private extensionUri: vscode.Uri) {
    this.diffManager = new DiffManager();
    // Initialize from VS Code config (can be overridden per-panel)
    const config = vscode.workspace.getConfiguration('claude-unbound');
    this._permissionMode = config.get<PermissionMode>('permissionMode', 'default');
  }

  setPermissionMode(mode: PermissionMode): void {
    this._permissionMode = mode;
  }

  getPermissionMode(): PermissionMode {
    return this._permissionMode;
  }

  setPostMessage(fn: (msg: ExtensionToWebviewMessage) => void): void {
    this.postMessageToWebview = fn;
  }

  async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    context: CanUseToolContext
  ): Promise<PermissionResult> {
    if (this._permissionMode === 'bypassPermissions') {
      return { behavior: 'allow', updatedInput: input };
    }

    if (this._permissionMode === 'plan') {
      return { behavior: 'deny', message: 'Plan mode: tools are disabled' };
    }

    if (toolName === 'Edit' || toolName === 'Write') {
      if (this._permissionMode === 'acceptEdits') {
        return { behavior: 'allow', updatedInput: input };
      }
      const typedInput = input as unknown as FileEditInput | FileWriteInput;
      const result = await this.requestFilePermissionFromWebview(toolName, typedInput, context);

      if (!result.approved) {
        return {
          behavior: 'deny',
          message: result.customMessage || 'User rejected the file modification',
        };
      }

      return { behavior: 'allow', updatedInput: input };
    }

    if (toolName === 'Bash') {
      const result = await this.requestBashPermissionFromWebview(input, context);

      if (!result.approved) {
        return {
          behavior: 'deny',
          message: result.customMessage || 'User rejected the bash command',
        };
      }

      return { behavior: 'allow', updatedInput: input };
    }

    // These tools are safe to auto-allow because they don't modify files or system state
    // NOTE: Bash is intentionally NOT included - it can execute destructive commands
    const readOnlyTools = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'LSP'];
    if (readOnlyTools.includes(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }

    // MCP tools are auto-allowed when the user has explicitly enabled the MCP server.
    // This mirrors Claude Code CLI behavior: enabling a server = trusting its tools.
    // The security boundary is at the server level, not individual tool level.
    if (toolName.startsWith('mcp__')) {
      return { behavior: 'allow', updatedInput: input };
    }

    const result = await vscode.window.showInformationMessage(
      `Claude wants to use the "${toolName}" tool. Allow?`,
      { modal: true },
      'Allow',
      'Deny'
    );

    if (result === 'Allow') {
      return { behavior: 'allow', updatedInput: input };
    }

    return {
      behavior: 'deny',
      message: `User denied permission for ${toolName}`,
    };
  }

  private async requestFilePermissionFromWebview(
    toolName: string,
    input: FileEditInput | FileWriteInput,
    context: CanUseToolContext
  ): Promise<ApprovalResult> {
    if (!this.postMessageToWebview) {
      return { approved: false, customMessage: 'Cannot request permission: webview not available' };
    }

    const toolUseId = context.toolUseID;
    if (!toolUseId) {
      return { approved: false, customMessage: 'Cannot request permission: no tool use ID' };
    }

    const filePath = input.file_path;
    const diffInput = toolName === 'Write'
      ? { content: (input as FileWriteInput).content }
      : { old_string: (input as FileEditInput).old_string, new_string: (input as FileEditInput).new_string };

    const diffResult = await this.diffManager.prepareDiff(toolUseId, toolName, filePath, diffInput);
    if (!diffResult && toolName === 'Edit') {
      return { approved: false, customMessage: 'Could not find the text to replace in the file' };
    }

    const originalContent = diffResult?.originalContent || '';
    const proposedContent = diffResult?.proposedContent || '';

    await this.diffManager.showDiffView(toolUseId, filePath, originalContent, proposedContent);

    return new Promise<ApprovalResult>((resolve) => {
      const abortHandler = () => {
        this.diffManager.closeDiffView(toolUseId);
        this.pendingApprovals.delete(toolUseId);
        resolve({ approved: false });
      };

      const cleanup = () => {
        context.signal.removeEventListener('abort', abortHandler);
      };

      this.pendingApprovals.set(toolUseId, {
        resolve,
        reject: () => resolve({ approved: false }),
        cleanup,
        diffId: toolUseId,
      });

      context.signal.addEventListener('abort', abortHandler, { once: true });

      this.postMessageToWebview!({
        type: 'requestPermission',
        toolUseId,
        toolName: toolName as 'Write' | 'Edit',
        toolInput: input as unknown as Record<string, unknown>,
        filePath,
        originalContent,
        proposedContent,
        parentToolUseId: context.parentToolUseId,
      });
    });
  }

  private async requestBashPermissionFromWebview(
    input: Record<string, unknown>,
    context: CanUseToolContext
  ): Promise<ApprovalResult> {
    const command = typeof input.command === 'string' ? input.command : JSON.stringify(input);

    if (!this.postMessageToWebview) {
      return { approved: false, customMessage: 'Cannot request permission: webview not available' };
    }

    const toolUseId = context.toolUseID;
    if (!toolUseId) {
      return { approved: false, customMessage: 'Cannot request permission: no tool use ID' };
    }

    return new Promise<ApprovalResult>((resolve) => {
      const abortHandler = () => {
        this.pendingApprovals.delete(toolUseId);
        resolve({ approved: false });
      };

      const cleanup = () => {
        context.signal.removeEventListener('abort', abortHandler);
      };

      this.pendingApprovals.set(toolUseId, {
        resolve,
        reject: () => resolve({ approved: false }),
        cleanup,
      });

      context.signal.addEventListener('abort', abortHandler, { once: true });

      this.postMessageToWebview!({
        type: 'requestPermission',
        toolUseId,
        toolName: 'Bash',
        toolInput: input,
        command,
        parentToolUseId: context.parentToolUseId,
      });
    });
  }

  async resolveApproval(toolUseId: string, approved: boolean, options?: { customMessage?: string }): Promise<void> {
    const pending = this.pendingApprovals.get(toolUseId);
    if (!pending) {
      return;
    }

    if (pending.diffId) {
      await this.diffManager.closeDiffView(pending.diffId);
    }

    pending.cleanup();
    pending.resolve({
      approved,
      customMessage: options?.customMessage,
    });
    this.pendingApprovals.delete(toolUseId);
  }

  async dispose(): Promise<void> {
    await this.diffManager.dispose();
  }
}
