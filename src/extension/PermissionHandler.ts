import * as vscode from 'vscode';
import { DiffManager } from './DiffManager';
import { loadSkillDescription } from './skills/utils';
import type { FileEditInput, FileWriteInput, ExtensionToWebviewMessage, PermissionMode, Question } from '../shared/types';

export interface PermissionResult {
  behavior: 'allow' | 'deny';
  message?: string;
  updatedInput?: unknown;
  interrupt?: boolean;
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

interface QuestionResult {
  approved: boolean;
  answers?: Record<string, string>;
}

interface PendingQuestion {
  resolve: (result: QuestionResult) => void;
  cleanup: () => void;
}

interface PlanApprovalResult {
  approved: boolean;
  approvalMode?: 'acceptEdits' | 'manual';
  feedback?: string;
}

interface PendingPlanApproval {
  resolve: (result: PlanApprovalResult) => void;
  cleanup: () => void;
}

interface EnterPlanApprovalResult {
  approved: boolean;
  customMessage?: string;
}

interface PendingEnterPlanApproval {
  resolve: (result: EnterPlanApprovalResult) => void;
  cleanup: () => void;
}

interface SkillApprovalResult {
  approved: boolean;
  approvalMode?: 'acceptEdits' | 'manual';
  customMessage?: string;
}

interface PendingSkillApproval {
  resolve: (result: SkillApprovalResult) => void;
  cleanup: () => void;
}

export class PermissionHandler {
  private diffManager: DiffManager;
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private pendingPlanApprovals: Map<string, PendingPlanApproval> = new Map();
  private pendingEnterPlanApprovals: Map<string, PendingEnterPlanApproval> = new Map();
  private pendingSkillApprovals: Map<string, PendingSkillApproval> = new Map();
  private autoApprovedSkills: Set<string> = new Set();
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

    if (toolName === 'EnterPlanMode') {
      if (this._permissionMode === 'plan') {
        return { behavior: 'allow', updatedInput: input };
      }

      const result = await this.requestEnterPlanApprovalFromWebview(context);

      if (!result.approved) {
        const message = result.customMessage
          ? `The user doesn't want to proceed with this tool use. The tool use was rejected. The user provided the following reason for the rejection: ${result.customMessage}`
          : 'User chose not to enter plan mode';
        return {
          behavior: 'deny',
          message,
          interrupt: !result.customMessage,
        };
      }

      return { behavior: 'allow', updatedInput: input };
    }

    if (toolName === 'ExitPlanMode' && this._permissionMode === 'plan') {
      const result = await this.requestPlanApprovalFromWebview(input, context);

      if (!result.approved) {
        const message = result.feedback
          ? `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection: ${result.feedback}`
          : 'User wants to revise the plan';
        return {
          behavior: 'deny',
          message,
        };
      }

      return {
        behavior: 'allow',
        updatedInput: {
          ...input,
          approved: true,
          approvalMode: result.approvalMode,
        },
      };
    }

    if (toolName === 'Edit' || toolName === 'Write') {
      if (this._permissionMode === 'acceptEdits') {
        return { behavior: 'allow', updatedInput: input };
      }
      const typedInput = input as unknown as FileEditInput | FileWriteInput;
      const result = await this.requestFilePermissionFromWebview(toolName, typedInput, context);

      if (!result.approved) {
        const message = result.customMessage
          ? `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). The user provided the following reason for the rejection: ${result.customMessage}`
          : 'User rejected the file modification';
        return {
          behavior: 'deny',
          message,
        };
      }

      return { behavior: 'allow', updatedInput: input };
    }

    if (toolName === 'Bash') {
      const result = await this.requestBashPermissionFromWebview(input, context);

      if (!result.approved) {
        const message = result.customMessage
          ? `The user doesn't want to proceed with this tool use. The tool use was rejected. The user provided the following reason for the rejection: ${result.customMessage}`
          : 'User rejected the bash command';
        return {
          behavior: 'deny',
          message,
        };
      }

      return { behavior: 'allow', updatedInput: input };
    }

    if (toolName === 'AskUserQuestion') {
      const questions = input.questions as Question[] | undefined;
      if (!questions || questions.length === 0) {
        return { behavior: 'allow', updatedInput: { questions: [], answers: {} } };
      }

      const result = await this.requestQuestionFromWebview(questions, context);

      if (!result.approved || !result.answers) {
        return { behavior: 'deny', message: 'User cancelled the question prompt' };
      }

      return {
        behavior: 'allow',
        updatedInput: { questions, answers: result.answers },
      };
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

    if (toolName === 'Skill') {
      const skillName = typeof input.skill === 'string' ? input.skill : '';

      if (this.autoApprovedSkills.has(skillName)) {
        return { behavior: 'allow', updatedInput: input };
      }

      const skillDescription = await loadSkillDescription(skillName);
      const result = await this.requestSkillApprovalFromWebview(skillName, skillDescription, context);

      if (!result.approved) {
        const message = result.customMessage
          ? `The user doesn't want to proceed with this tool use. The tool use was rejected. The user provided the following reason for the rejection: ${result.customMessage}`
          : `User denied permission for skill "${skillName}"`;
        return {
          behavior: 'deny',
          message,
          interrupt: !result.customMessage,
        };
      }

      if (result.approvalMode === 'acceptEdits') {
        this.autoApprovedSkills.add(skillName);
      }

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

  private async requestQuestionFromWebview(
    questions: Question[],
    context: CanUseToolContext
  ): Promise<QuestionResult> {
    if (!this.postMessageToWebview) {
      return { approved: false };
    }

    const toolUseId = context.toolUseID;
    if (!toolUseId) {
      return { approved: false };
    }

    return new Promise<QuestionResult>((resolve) => {
      const abortHandler = () => {
        this.pendingQuestions.delete(toolUseId);
        resolve({ approved: false });
      };

      const cleanup = () => {
        context.signal.removeEventListener('abort', abortHandler);
      };

      this.pendingQuestions.set(toolUseId, { resolve, cleanup });
      context.signal.addEventListener('abort', abortHandler, { once: true });

      this.postMessageToWebview!({
        type: 'requestQuestion',
        toolUseId,
        questions,
        parentToolUseId: context.parentToolUseId,
      });
    });
  }

  resolveQuestion(toolUseId: string, answers: Record<string, string> | null): void {
    const pending = this.pendingQuestions.get(toolUseId);
    if (!pending) {
      return;
    }

    pending.cleanup();
    pending.resolve({
      approved: answers !== null,
      answers: answers ?? undefined,
    });
    this.pendingQuestions.delete(toolUseId);
  }

  private async requestPlanApprovalFromWebview(
    input: Record<string, unknown>,
    context: CanUseToolContext
  ): Promise<PlanApprovalResult> {
    const toolUseId = context.toolUseID;
    if (!toolUseId || !this.postMessageToWebview) {
      return { approved: false };
    }

    const planContent = typeof input.plan === 'string' ? input.plan : '';

    return new Promise<PlanApprovalResult>((resolve) => {
      const abortHandler = () => {
        this.pendingPlanApprovals.delete(toolUseId);
        resolve({ approved: false });
      };

      const cleanup = () => {
        context.signal.removeEventListener('abort', abortHandler);
      };

      this.pendingPlanApprovals.set(toolUseId, { resolve, cleanup });
      context.signal.addEventListener('abort', abortHandler, { once: true });

      this.postMessageToWebview!({
        type: 'requestPlanApproval',
        toolUseId,
        planContent,
        parentToolUseId: context.parentToolUseId,
      });
    });
  }

  resolvePlanApproval(
    toolUseId: string,
    approved: boolean,
    options?: { approvalMode?: 'acceptEdits' | 'manual'; feedback?: string }
  ): void {
    const pending = this.pendingPlanApprovals.get(toolUseId);
    if (!pending) {
      return;
    }

    pending.cleanup();
    pending.resolve({
      approved,
      approvalMode: options?.approvalMode,
      feedback: options?.feedback,
    });
    this.pendingPlanApprovals.delete(toolUseId);
  }

  private async requestEnterPlanApprovalFromWebview(
    context: CanUseToolContext
  ): Promise<EnterPlanApprovalResult> {
    const toolUseId = context.toolUseID;
    if (!toolUseId || !this.postMessageToWebview) {
      return { approved: false };
    }

    return new Promise<EnterPlanApprovalResult>((resolve) => {
      const abortHandler = () => {
        this.pendingEnterPlanApprovals.delete(toolUseId);
        resolve({ approved: false });
      };

      const cleanup = () => {
        context.signal.removeEventListener('abort', abortHandler);
      };

      this.pendingEnterPlanApprovals.set(toolUseId, { resolve, cleanup });
      context.signal.addEventListener('abort', abortHandler, { once: true });

      this.postMessageToWebview!({
        type: 'requestEnterPlanMode',
        toolUseId,
        parentToolUseId: context.parentToolUseId,
      });
    });
  }

  resolveEnterPlanApproval(
    toolUseId: string,
    approved: boolean,
    options?: { customMessage?: string }
  ): void {
    const pending = this.pendingEnterPlanApprovals.get(toolUseId);
    if (!pending) {
      return;
    }

    pending.cleanup();
    pending.resolve({
      approved,
      customMessage: options?.customMessage,
    });
    this.pendingEnterPlanApprovals.delete(toolUseId);
  }

  private async requestSkillApprovalFromWebview(
    skillName: string,
    skillDescription: string | undefined,
    context: CanUseToolContext
  ): Promise<SkillApprovalResult> {
    const toolUseId = context.toolUseID;
    if (!toolUseId || !this.postMessageToWebview) {
      return { approved: false };
    }

    return new Promise<SkillApprovalResult>((resolve) => {
      const abortHandler = () => {
        this.pendingSkillApprovals.delete(toolUseId);
        resolve({ approved: false });
      };

      const cleanup = () => {
        context.signal.removeEventListener('abort', abortHandler);
      };

      this.pendingSkillApprovals.set(toolUseId, { resolve, cleanup });
      context.signal.addEventListener('abort', abortHandler, { once: true });

      this.postMessageToWebview!({
        type: 'requestSkillApproval',
        toolUseId,
        skillName,
        skillDescription,
        parentToolUseId: context.parentToolUseId,
      });
    });
  }

  resolveSkillApproval(
    toolUseId: string,
    approved: boolean,
    options?: { approvalMode?: 'acceptEdits' | 'manual'; customMessage?: string }
  ): void {
    const pending = this.pendingSkillApprovals.get(toolUseId);
    if (!pending) {
      return;
    }

    pending.cleanup();
    pending.resolve({
      approved,
      approvalMode: options?.approvalMode,
      customMessage: options?.customMessage,
    });
    this.pendingSkillApprovals.delete(toolUseId);
  }

  async dispose(): Promise<void> {
    await this.diffManager.dispose();
  }
}
