import * as vscode from 'vscode';
import { DiffManager } from './DiffManager';
import type { FileEditInput, FileWriteInput, ExtensionToWebviewMessage } from '../shared/types';

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

interface ApprovalResult {
  approved: boolean;
  neverAskAgain?: boolean;
  customMessage?: string;
}

export class PermissionHandler {
  private diffManager: DiffManager;
  private pendingApproval: {
    resolve: (result: ApprovalResult) => void;
    reject: (error: Error) => void;
    cleanup: () => void;  // Cleanup function to remove abort listener
  } | null = null;
  private postMessageToWebview: ((msg: ExtensionToWebviewMessage) => void) | null = null;

  constructor(private extensionUri: vscode.Uri) {
    this.diffManager = new DiffManager();
  }

  setPostMessage(fn: (msg: ExtensionToWebviewMessage) => void): void {
    this.postMessageToWebview = fn;
  }

  async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    context: CanUseToolContext
  ): Promise<PermissionResult> {
    const config = vscode.workspace.getConfiguration('claude-unbound');
    const permissionMode = config.get<string>('permissionMode', 'default');

    if (permissionMode === 'bypassPermissions') {
      return { behavior: 'allow', updatedInput: input };
    }

    if (toolName === 'Edit' || toolName === 'Write') {
      if (permissionMode === 'acceptEdits') {
        return { behavior: 'allow', updatedInput: input };
      }
      const typedInput = input as unknown as FileEditInput | FileWriteInput;
      const result = await this.requestFilePermissionFromWebview(toolName, typedInput, context);

      if (result.neverAskAgain) {
        await config.update('permissionMode', 'acceptEdits', vscode.ConfigurationTarget.Global);
      }

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

      if (result.neverAskAgain) {
        await config.update('permissionMode', 'acceptEdits', vscode.ConfigurationTarget.Global);
      }

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

    const filePath = input.file_path;
    const diffInput = toolName === 'Write'
      ? { content: (input as FileWriteInput).content }
      : { old_string: (input as FileEditInput).old_string, new_string: (input as FileEditInput).new_string };

    const diffInfo = await this.diffManager.prepareDiff(toolName, filePath, diffInput);
    if (!diffInfo && toolName === 'Edit') {
      return { approved: false, customMessage: 'Could not find the text to replace in the file' };
    }

    const originalContent = diffInfo?.originalContent || '';
    const proposedContent = diffInfo?.proposedContent || '';

    await this.diffManager.showDiffView(filePath, originalContent, proposedContent);

    return new Promise<ApprovalResult>((resolve) => {
      const abortHandler = () => {
        this.diffManager.closeDiffView();
        this.pendingApproval = null;
        resolve({ approved: false });
      };

      // Create cleanup function to remove the abort listener when resolved normally
      const cleanup = () => {
        context.signal.removeEventListener('abort', abortHandler);
      };

      this.pendingApproval = {
        resolve,
        reject: () => resolve({ approved: false }),
        cleanup,
      };

      context.signal.addEventListener('abort', abortHandler, { once: true });

      this.postMessageToWebview!({
        type: 'requestPermission',
        toolUseId: context.toolUseID,
        toolName: toolName as 'Write' | 'Edit',
        toolInput: input as unknown as Record<string, unknown>,
        filePath,
        originalContent,
        proposedContent,
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

    return new Promise<ApprovalResult>((resolve) => {
      const abortHandler = () => {
        this.pendingApproval = null;
        resolve({ approved: false });
      };

      const cleanup = () => {
        context.signal.removeEventListener('abort', abortHandler);
      };

      this.pendingApproval = {
        resolve,
        reject: () => resolve({ approved: false }),
        cleanup,
      };

      context.signal.addEventListener('abort', abortHandler, { once: true });

      this.postMessageToWebview!({
        type: 'requestPermission',
        toolUseId: context.toolUseID,
        toolName: 'Bash',
        toolInput: input,
        command,
      });
    });
  }

  async resolveApproval(approved: boolean, options?: { neverAskAgain?: boolean; customMessage?: string }): Promise<void> {
    await this.diffManager.closeDiffView();

    if (this.pendingApproval) {
      // Clean up abort listener before resolving
      this.pendingApproval.cleanup();
      this.pendingApproval.resolve({
        approved,
        neverAskAgain: options?.neverAskAgain,
        customMessage: options?.customMessage,
      });
      this.pendingApproval = null;
    }
  }

  async dispose(): Promise<void> {
    await this.diffManager.dispose();
  }
}
