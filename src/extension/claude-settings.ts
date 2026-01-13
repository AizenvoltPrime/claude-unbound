import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

function getUserSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.local.json");
}

function getProjectSettingsPath(): string | null {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    return path.join(workspaceFolder.uri.fsPath, ".claude", "settings.local.json");
  }
  return null;
}

export function getClaudeSettingsPath(): string {
  return getProjectSettingsPath() ?? getUserSettingsPath();
}

export async function readClaudeSettings(): Promise<Record<string, unknown>> {
  const projectPath = getProjectSettingsPath();
  const userPath = getUserSettingsPath();

  if (projectPath) {
    try {
      const content = await fs.promises.readFile(projectPath, "utf-8");
      return JSON.parse(content);
    } catch {
      // Project file doesn't exist, fall back to user settings
    }
  }

  try {
    const content = await fs.promises.readFile(userPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}
