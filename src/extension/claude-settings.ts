import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { log } from "./logger";

export async function getClaudeSettingsPath(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const projectSettingsPath = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".claude", "settings.local.json")
    : null;
  const userSettingsPath = path.join(os.homedir(), ".claude", "settings.local.json");

  if (projectSettingsPath) {
    try {
      await fs.promises.access(projectSettingsPath);
      return projectSettingsPath;
    } catch {
    }
  }
  return userSettingsPath;
}

export async function readClaudeSettings(): Promise<Record<string, unknown>> {
  const settingsPath = await getClaudeSettingsPath();
  try {
    const content = await fs.promises.readFile(settingsPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function readThinkingTokensFromClaudeSettings(): Promise<number | null> {
  try {
    const settings = await readClaudeSettings();
    const env = settings.env as Record<string, string> | undefined;
    const value = env?.MAX_THINKING_TOKENS;
    if (value) {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function syncThinkingTokensToClaudeSettings(tokens: number | null): Promise<void> {
  const settingsPath = await getClaudeSettingsPath();

  try {
    const settings = await readClaudeSettings();

    const env = (typeof settings.env === "object" && settings.env !== null)
      ? settings.env as Record<string, string>
      : {};

    if (tokens !== null) {
      env.MAX_THINKING_TOKENS = String(tokens);
    } else {
      delete env.MAX_THINKING_TOKENS;
    }

    settings.env = env;

    await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    log("[ClaudeSettings] syncThinkingTokensToClaudeSettings: wrote to", settingsPath);
  } catch (err) {
    log("[ClaudeSettings] syncThinkingTokensToClaudeSettings: failed to write", err);
  }
}
