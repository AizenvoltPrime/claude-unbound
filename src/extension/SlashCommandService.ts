import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import type { CustomSlashCommandInfo, PluginSlashCommandInfo } from "../shared/types";
import { log } from "./logger";

const COMMANDS_FOLDER = ".claude/commands";
const PLUGINS_FOLDER = ".claude/plugins";
const INSTALLED_PLUGINS_FILE = "installed_plugins.json";
const VALID_COMMAND_NAME = /^[a-zA-Z0-9_-]+$/;

interface ParsedMarkdownFile {
  description: string;
  argumentHint?: string;
  name?: string;
}

interface InstalledPluginEntry {
  scope: "user" | "project";
  projectPath?: string;
  installPath: string;
  version: string;
}

interface InstalledPluginsRegistry {
  version: number;
  plugins: Record<string, InstalledPluginEntry[]>;
}

export class SlashCommandService {
  private cache: CustomSlashCommandInfo[] | null = null;
  private pluginCache: PluginSlashCommandInfo[] | null = null;
  private projectWatcher: vscode.FileSystemWatcher | null = null;
  private userWatcher: vscode.FileSystemWatcher | null = null;
  private pluginWatcher: vscode.FileSystemWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(private workspacePath: string) {
    this.setupFileWatchers();
  }

  private setupFileWatchers(): void {
    const invalidateCache = () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.cache = null;
        log("Slash command cache invalidated due to file change");
      }, 300);
    };

    const invalidatePluginCache = () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.pluginCache = null;
        log("Plugin command cache invalidated due to file change");
      }, 300);
    };

    const projectPattern = new vscode.RelativePattern(
      this.workspacePath,
      `${COMMANDS_FOLDER}/**/*.md`
    );
    this.projectWatcher = vscode.workspace.createFileSystemWatcher(projectPattern);
    this.projectWatcher.onDidCreate(invalidateCache);
    this.projectWatcher.onDidChange(invalidateCache);
    this.projectWatcher.onDidDelete(invalidateCache);

    const userCommandsPath = path.join(os.homedir(), COMMANDS_FOLDER);
    const userPattern = `${userCommandsPath.replace(/\\/g, "/")}/**/*.md`;
    this.userWatcher = vscode.workspace.createFileSystemWatcher(userPattern);
    this.userWatcher.onDidCreate(invalidateCache);
    this.userWatcher.onDidChange(invalidateCache);
    this.userWatcher.onDidDelete(invalidateCache);

    const registryPath = path.join(os.homedir(), PLUGINS_FOLDER, INSTALLED_PLUGINS_FILE);
    this.pluginWatcher = vscode.workspace.createFileSystemWatcher(registryPath.replace(/\\/g, "/"));
    this.pluginWatcher.onDidCreate(invalidatePluginCache);
    this.pluginWatcher.onDidChange(invalidatePluginCache);
    this.pluginWatcher.onDidDelete(invalidatePluginCache);
  }

  async getCommands(): Promise<CustomSlashCommandInfo[]> {
    if (this.cache) {
      return this.cache;
    }

    const commands: CustomSlashCommandInfo[] = [];

    const projectCommandsDir = path.join(this.workspacePath, COMMANDS_FOLDER);
    const projectCommands = await this.scanDirectory(projectCommandsDir, "project");
    commands.push(...projectCommands);

    const userCommandsDir = path.join(os.homedir(), COMMANDS_FOLDER);
    const userCommands = await this.scanDirectory(userCommandsDir, "user");

    for (const userCmd of userCommands) {
      const exists = commands.some((c) => c.name === userCmd.name);
      if (!exists) {
        commands.push(userCmd);
      }
    }

    commands.sort((a, b) => a.name.localeCompare(b.name));

    this.cache = commands;
    return commands;
  }

  private async scanDirectory(
    dir: string,
    source: "project" | "user"
  ): Promise<CustomSlashCommandInfo[]> {
    const commands: CustomSlashCommandInfo[] = [];

    try {
      await fs.promises.access(dir, fs.constants.R_OK);
    } catch {
      return commands;
    }

    const rootCommands = await this.scanDirectoryFiles(dir, source, undefined);
    commands.push(...rootCommands);

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subdir = path.join(dir, entry.name);
          const subdirCommands = await this.scanDirectoryFiles(
            subdir,
            source,
            entry.name
          );
          commands.push(...subdirCommands);
        }
      }
    } catch (err) {
      log(`Error scanning subdirectories in ${dir}: ${err}`);
    }

    return commands;
  }

  private async scanDirectoryFiles(
    dir: string,
    source: "project" | "user",
    namespace: string | undefined
  ): Promise<CustomSlashCommandInfo[]> {
    const commands: CustomSlashCommandInfo[] = [];

    try {
      const files = await fs.promises.readdir(dir);

      for (const file of files) {
        if (!file.endsWith(".md")) continue;

        const commandName = file.replace(/\.md$/, "");
        if (!VALID_COMMAND_NAME.test(commandName)) {
          log(`Skipping invalid command name: ${commandName}`);
          continue;
        }

        const filePath = path.join(dir, file);

        try {
          const content = await fs.promises.readFile(filePath, "utf-8");
          const parsed = this.parseMarkdownFile(content);

          commands.push({
            name: commandName,
            description: parsed.description,
            argumentHint: parsed.argumentHint,
            filePath,
            source,
            namespace,
          });
        } catch (err) {
          log(`Error reading command file ${filePath}: ${err}`);
        }
      }
    } catch (err) {
      log(`Error scanning directory ${dir}: ${err}`);
    }

    return commands;
  }

  private parseMarkdownFile(content: string): ParsedMarkdownFile {
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const body = frontmatterMatch[2].trim();

      let description = "";
      let argumentHint: string | undefined;

      const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descriptionMatch) {
        description = descriptionMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      const argumentHintMatch = frontmatter.match(/^argument-hint:\s*(.+)$/m);
      if (argumentHintMatch) {
        argumentHint = argumentHintMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      if (!description) {
        description = this.extractFirstLine(body);
      }

      return { description, argumentHint };
    }

    const body = content.trim();
    const description = this.extractFirstLine(body);
    return { description };
  }

  private extractFirstLine(content: string): string {
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        return this.stripMarkdownFormatting(trimmed).slice(0, 100);
      }
    }
    return "No description";
  }

  private stripMarkdownFormatting(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  }

  async getPluginCommands(enabledPluginIds?: Set<string>): Promise<PluginSlashCommandInfo[]> {
    if (!this.pluginCache) {
      const commands: PluginSlashCommandInfo[] = [];
      const registryPath = path.join(os.homedir(), PLUGINS_FOLDER, INSTALLED_PLUGINS_FILE);

      try {
        const content = await fs.promises.readFile(registryPath, "utf-8");
        const registry = JSON.parse(content) as InstalledPluginsRegistry;

        for (const [fullName, entries] of Object.entries(registry.plugins)) {
          for (const entry of entries) {
            if (entry.scope === "project" && entry.projectPath !== this.workspacePath) {
              continue;
            }

            const pluginCommands = await this.scanPluginCommands(entry.installPath, fullName);
            commands.push(...pluginCommands);
          }
        }
      } catch (err) {
        const isFileNotFound = (err as NodeJS.ErrnoException).code === "ENOENT";
        if (!isFileNotFound) {
          log(`Error reading plugins registry for commands: ${err}`);
        }
      }

      commands.sort((a, b) => a.name.localeCompare(b.name));
      this.pluginCache = commands;
    }

    if (enabledPluginIds) {
      return this.pluginCache.filter(cmd => enabledPluginIds.has(cmd.pluginFullId));
    }
    return this.pluginCache;
  }

  private async scanPluginCommands(pluginPath: string, pluginFullId: string): Promise<PluginSlashCommandInfo[]> {
    const pluginShortName = pluginFullId.split("@")[0];
    const commandsDir = path.join(pluginPath, "commands");
    return this.scanPluginCommandsDir(commandsDir, pluginShortName, pluginFullId);
  }

  private async scanPluginCommandsDir(dir: string, pluginShortName: string, pluginFullId: string): Promise<PluginSlashCommandInfo[]> {
    const commands: PluginSlashCommandInfo[] = [];

    try {
      await fs.promises.access(dir, fs.constants.R_OK);
    } catch {
      return commands;
    }

    try {
      const files = await fs.promises.readdir(dir);

      for (const file of files) {
        if (!file.endsWith(".md")) continue;

        const commandName = file.replace(/\.md$/, "");
        if (!VALID_COMMAND_NAME.test(commandName)) {
          continue;
        }

        const filePath = path.join(dir, file);

        try {
          const content = await fs.promises.readFile(filePath, "utf-8");
          const parsed = this.parseMarkdownFile(content);

          commands.push({
            name: `${pluginShortName}:${commandName}`,
            description: parsed.description,
            argumentHint: parsed.argumentHint,
            filePath,
            source: "plugin",
            pluginName: pluginShortName,
            pluginFullId,
          });
        } catch (err) {
          log(`Error reading plugin command file ${filePath}: ${err}`);
        }
      }
    } catch (err) {
      log(`Error scanning plugin commands directory ${dir}: ${err}`);
    }

    return commands;
  }

  dispose(): void {
    if (this.projectWatcher) {
      this.projectWatcher.dispose();
      this.projectWatcher = null;
    }
    if (this.userWatcher) {
      this.userWatcher.dispose();
      this.userWatcher = null;
    }
    if (this.pluginWatcher) {
      this.pluginWatcher.dispose();
      this.pluginWatcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
