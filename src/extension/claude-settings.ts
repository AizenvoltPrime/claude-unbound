import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { log } from "./logger";
import { DEFAULT_THINKING_TOKENS } from "../shared/types";

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

export async function readThinkingTokensFromClaudeSettings(): Promise<number> {
  try {
    const settings = await readClaudeSettings();
    const env = settings.env as Record<string, string> | undefined;
    const value = env?.MAX_THINKING_TOKENS;
    if (value) {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? DEFAULT_THINKING_TOKENS : parsed;
    }
    return DEFAULT_THINKING_TOKENS;
  } catch {
    return DEFAULT_THINKING_TOKENS;
  }
}

export async function syncThinkingTokensToClaudeSettings(tokens: number | null): Promise<void> {
  const settingsPath = getClaudeSettingsPath();
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
}
