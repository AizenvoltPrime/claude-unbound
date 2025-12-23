import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class DiffManager {
  private tempDir: string;
  private pendingDiffs: Map<
    string,
    {
      resolve: (approved: boolean) => void;
      originalUri: vscode.Uri;
      proposedUri: vscode.Uri;
    }
  > = new Map();

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'claude-unbound-diffs');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async showWriteDiff(
    filePath: string,
    newContent: string,
    signal: AbortSignal
  ): Promise<boolean> {
    const fileUri = vscode.Uri.file(filePath);
    const fileName = path.basename(filePath);

    // Get original content (empty if file doesn't exist)
    let originalContent = '';
    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      originalContent = document.getText();
    } catch {
      // File doesn't exist, that's fine
    }

    return this.showDiff(fileName, originalContent, newContent, filePath, signal);
  }

  async showEditDiff(
    filePath: string,
    oldString: string,
    newString: string,
    signal: AbortSignal
  ): Promise<boolean> {
    const fileUri = vscode.Uri.file(filePath);
    const fileName = path.basename(filePath);

    // Read current file content
    let currentContent = '';
    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      currentContent = document.getText();
    } catch {
      return false; // Can't edit a file that doesn't exist
    }

    // Apply the edit to show proposed content
    const proposedContent = currentContent.replace(oldString, newString);

    if (proposedContent === currentContent) {
      // oldString not found in file
      vscode.window.showWarningMessage(
        `Could not find the text to replace in ${fileName}`
      );
      return false;
    }

    return this.showDiff(fileName, currentContent, proposedContent, filePath, signal);
  }

  private async showDiff(
    fileName: string,
    originalContent: string,
    proposedContent: string,
    originalPath: string,
    signal: AbortSignal
  ): Promise<boolean> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Create temp files
    const originalTempPath = path.join(this.tempDir, `${id}-original-${fileName}`);
    const proposedTempPath = path.join(this.tempDir, `${id}-proposed-${fileName}`);

    fs.writeFileSync(originalTempPath, originalContent);
    fs.writeFileSync(proposedTempPath, proposedContent);

    const originalUri = vscode.Uri.file(originalTempPath);
    const proposedUri = vscode.Uri.file(proposedTempPath);

    return new Promise<boolean>((resolve) => {
      // Store the pending diff
      this.pendingDiffs.set(id, { resolve, originalUri, proposedUri });

      // Handle abort
      const abortHandler = () => {
        this.cleanupDiff(id);
        resolve(false);
      };
      signal.addEventListener('abort', abortHandler, { once: true });

      // Open diff view
      vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        proposedUri,
        `${fileName} (Current ↔ Proposed)`
      );

      // Show approval buttons
      this.showApprovalButtons(id, fileName, originalPath).then((approved) => {
        signal.removeEventListener('abort', abortHandler);
        this.cleanupDiff(id);
        resolve(approved);
      });
    });
  }

  private async showApprovalButtons(
    id: string,
    fileName: string,
    originalPath: string
  ): Promise<boolean> {
    const result = await vscode.window.showInformationMessage(
      `Apply changes to ${fileName}?`,
      { modal: false },
      'Apply',
      'Reject'
    );

    return result === 'Apply';
  }

  private cleanupDiff(id: string): void {
    const pending = this.pendingDiffs.get(id);
    if (pending) {
      // Clean up temp files
      try {
        fs.unlinkSync(pending.originalUri.fsPath);
        fs.unlinkSync(pending.proposedUri.fsPath);
      } catch {
        // Ignore cleanup errors
      }
      this.pendingDiffs.delete(id);
    }
  }

  dispose(): void {
    // Clean up all pending diffs
    for (const [id] of this.pendingDiffs) {
      this.cleanupDiff(id);
    }

    // Try to remove temp directory
    try {
      fs.rmdirSync(this.tempDir);
    } catch {
      // Ignore if not empty or other errors
    }
  }
}
