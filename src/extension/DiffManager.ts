import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DiffInfo {
  originalContent: string;
  proposedContent: string;
}

export class DiffManager {
  private tempDir: string;
  private activeDiff: {
    id: string;
    originalUri: vscode.Uri;
    proposedUri: vscode.Uri;
  } | null = null;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'claude-unbound-diffs');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async prepareDiff(
    toolName: string,
    filePath: string,
    input: { content?: string; old_string?: string; new_string?: string }
  ): Promise<DiffInfo | null> {
    const fileUri = vscode.Uri.file(filePath);

    let originalContent = '';
    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      originalContent = document.getText();
    } catch {
      // File doesn't exist
    }

    let proposedContent: string;
    if (toolName === 'Write') {
      proposedContent = input.content || '';
    } else {
      if (!originalContent) {
        return null;
      }
      proposedContent = originalContent.replace(input.old_string || '', input.new_string || '');
      if (proposedContent === originalContent) {
        return null;
      }
    }

    return { originalContent, proposedContent };
  }

  async showDiffView(filePath: string, originalContent: string, proposedContent: string): Promise<void> {
    this.cleanupActiveDiff();

    const fileName = path.basename(filePath);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const originalTempPath = path.join(this.tempDir, `${id}-original-${fileName}`);
    const proposedTempPath = path.join(this.tempDir, `${id}-proposed-${fileName}`);

    fs.writeFileSync(originalTempPath, originalContent);
    fs.writeFileSync(proposedTempPath, proposedContent);

    const originalUri = vscode.Uri.file(originalTempPath);
    const proposedUri = vscode.Uri.file(proposedTempPath);

    this.activeDiff = { id, originalUri, proposedUri };

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      `${fileName} (Current ↔ Proposed)`,
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false }
    );
  }

  async closeDiffView(): Promise<void> {
    await this.cleanupActiveDiff();
  }

  private async cleanupActiveDiff(): Promise<void> {
    if (this.activeDiff) {
      const proposedUri = this.activeDiff.proposedUri;

      // Close the diff editor tab by finding and closing tabs with our temp file
      for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
          if (tab.input instanceof vscode.TabInputTextDiff) {
            const diffInput = tab.input as vscode.TabInputTextDiff;
            if (diffInput.modified.fsPath === proposedUri.fsPath) {
              await vscode.window.tabGroups.close(tab);
              break;
            }
          }
        }
      }

      // Clean up temp files
      try {
        fs.unlinkSync(this.activeDiff.originalUri.fsPath);
        fs.unlinkSync(this.activeDiff.proposedUri.fsPath);
      } catch {
        // Ignore cleanup errors
      }
      this.activeDiff = null;
    }
  }

  /**
   * Disposes resources. Returns a promise that resolves when cleanup is complete.
   * The caller should await this if they need to ensure cleanup is done.
   */
  async dispose(): Promise<void> {
    // First clean up any active diff (closes tabs, deletes temp files)
    await this.cleanupActiveDiff();

    // Then try to remove the temp directory
    try {
      fs.rmdirSync(this.tempDir);
    } catch {
      // Ignore if not empty or other errors
    }
  }
}
