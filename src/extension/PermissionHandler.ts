import * as vscode from 'vscode';
import { DiffManager } from './DiffManager';
import type { FileEditInput, FileWriteInput } from '../shared/types';

export interface PermissionResult {
  behavior: 'allow' | 'deny';
  message?: string;
  updatedInput?: unknown;
}

export interface CanUseToolContext {
  signal: AbortSignal;
  toolUseID: string;
  agentID?: string;
}

export class PermissionHandler {
  private diffManager: DiffManager;
  private pendingApproval: {
    resolve: (approved: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(private extensionUri: vscode.Uri) {
    this.diffManager = new DiffManager();
  }

  async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    context: CanUseToolContext
  ): Promise<PermissionResult> {
    const config = vscode.workspace.getConfiguration('claude-unbound');
    const permissionMode = config.get<string>('permissionMode', 'ask');

    // Auto mode: allow all operations
    if (permissionMode === 'auto') {
      return { behavior: 'allow', updatedInput: input };
    }

    // For Edit and Write tools, show diff and wait for approval
    if (toolName === 'Edit' || toolName === 'Write') {
      const typedInput = input as unknown as FileEditInput | FileWriteInput;
      const approved = await this.showDiffAndAwaitApproval(toolName, typedInput, context.signal);

      if (!approved) {
        return {
          behavior: 'deny',
          message: 'User rejected the file modification',
        };
      }
    }

    // For Read, Glob, Grep, and other read-only tools, allow by default
    const readOnlyTools = ['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'LSP'];
    if (readOnlyTools.includes(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }

    // For other tools, ask user
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

  private async showDiffAndAwaitApproval(
    toolName: string,
    input: FileEditInput | FileWriteInput,
    signal: AbortSignal
  ): Promise<boolean> {
    const filePath = input.file_path;

    if (toolName === 'Write') {
      const writeInput = input as FileWriteInput;
      return this.diffManager.showWriteDiff(filePath, writeInput.content, signal);
    } else {
      const editInput = input as FileEditInput;
      return this.diffManager.showEditDiff(
        filePath,
        editInput.old_string,
        editInput.new_string,
        signal
      );
    }
  }

  resolveApproval(approved: boolean): void {
    if (this.pendingApproval) {
      this.pendingApproval.resolve(approved);
      this.pendingApproval = null;
    }
  }

  dispose(): void {
    this.diffManager.dispose();
  }
}
