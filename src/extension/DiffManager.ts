import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DiffInfo {
  originalContent: string;
  proposedContent: string;
}

interface ActiveDiff {
  originalUri: vscode.Uri;
  proposedUri: vscode.Uri;
}

export class DiffManager {
  private tempDir: string;
  private activeDiffs: Map<string, ActiveDiff> = new Map();

  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'claude-unbound-diffs');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async prepareDiff(
    diffId: string,
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
      // File doesn't exist yet
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

  async showDiffView(diffId: string, filePath: string, originalContent: string, proposedContent: string): Promise<void> {
    const fileName = path.basename(filePath);

    const originalTempPath = path.join(this.tempDir, `${diffId}-original-${fileName}`);
    const proposedTempPath = path.join(this.tempDir, `${diffId}-proposed-${fileName}`);

    fs.writeFileSync(originalTempPath, originalContent);
    fs.writeFileSync(proposedTempPath, proposedContent);

    const originalUri = vscode.Uri.file(originalTempPath);
    const proposedUri = vscode.Uri.file(proposedTempPath);

    this.activeDiffs.set(diffId, { originalUri, proposedUri });

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      `${fileName} (Current ↔ Proposed)`,
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false }
    );
  }

  async closeDiffView(diffId: string): Promise<void> {
    const activeDiff = this.activeDiffs.get(diffId);
    if (!activeDiff) {
      return;
    }

    const proposedUri = activeDiff.proposedUri;

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

    try {
      fs.unlinkSync(activeDiff.originalUri.fsPath);
      fs.unlinkSync(activeDiff.proposedUri.fsPath);
    } catch {
      // Ignore cleanup errors
    }

    this.activeDiffs.delete(diffId);
  }

  async dispose(): Promise<void> {
    for (const diffId of this.activeDiffs.keys()) {
      await this.closeDiffView(diffId);
    }

    try {
      fs.rmdirSync(this.tempDir);
    } catch {
      // Ignore if not empty or other errors
    }
  }
}
