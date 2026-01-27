import * as childProcess from "child_process";
import * as path from "path";
import * as readline from "readline";
import * as fs from "fs";
import * as vscode from "vscode";

const isWindows = process.platform.startsWith("win");
const binName = isWindows ? "rg.exe" : "rg";

export interface FileResult {
  relativePath: string;
  isDirectory: boolean;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getRipgrepPath(vscodeAppRoot: string): Promise<string | undefined> {
  const checkPath = async (pkgFolder: string) => {
    const fullPath = path.join(vscodeAppRoot, pkgFolder, binName);
    return (await fileExists(fullPath)) ? fullPath : undefined;
  };

  return (
    (await checkPath("node_modules/@vscode/ripgrep/bin/")) ||
    (await checkPath("node_modules/vscode-ripgrep/bin")) ||
    (await checkPath("node_modules.asar.unpacked/vscode-ripgrep/bin/")) ||
    (await checkPath("node_modules.asar.unpacked/@vscode/ripgrep/bin/"))
  );
}

function getRipgrepSearchOptions(): string[] {
  const config = vscode.workspace.getConfiguration("search");
  const extraArgs: string[] = [];

  if (config.get("useIgnoreFiles") === false) {
    extraArgs.push("--no-ignore");
  }

  if (config.get("useGlobalIgnoreFiles") === false) {
    extraArgs.push("--no-ignore-global");
  }

  if (config.get("useParentIgnoreFiles") === false) {
    extraArgs.push("--no-ignore-parent");
  }

  return extraArgs;
}

export async function listWorkspaceFiles(
  workspacePath: string,
  limit?: number
): Promise<FileResult[]> {
  const effectiveLimit = limit ?? vscode.workspace.getConfiguration("damocles").get<number>("maxIndexedFiles", 5000);
  const rgPath = await getRipgrepPath(vscode.env.appRoot);

  if (!rgPath) {
    throw new Error("Could not find ripgrep binary");
  }

  const args = [
    "--files",
    "--follow",
    "--hidden",
    ...getRipgrepSearchOptions(),
    "-g", "!**/node_modules/**",
    "-g", "!**/.git/**",
    "-g", "!**/dist/**",
    "-g", "!**/build/**",
    "-g", "!**/out/**",
    "-g", "!**/.next/**",
    workspacePath,
  ];

  return new Promise((resolve, reject) => {
    const rgProcess = childProcess.spawn(rgPath, args);
    const rl = readline.createInterface({ input: rgProcess.stdout, crlfDelay: Infinity });

    const fileResults: FileResult[] = [];
    const dirSet = new Set<string>();
    let count = 0;

    rl.on("line", (line) => {
      if (count < effectiveLimit) {
        try {
          const relativePath = path.relative(workspacePath, line).replace(/\\/g, "/");

          fileResults.push({ relativePath, isDirectory: false });

          let dirPath = path.dirname(relativePath);
          while (dirPath && dirPath !== "." && dirPath !== "/") {
            dirSet.add(dirPath);
            dirPath = path.dirname(dirPath);
          }

          count++;
        } catch {
          // Silently ignore errors processing individual paths
        }
      } else {
        rl.close();
        rgProcess.kill();
      }
    });

    let errorOutput = "";

    rgProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    rl.on("close", () => {
      if (errorOutput && fileResults.length === 0) {
        reject(new Error(`ripgrep error: ${errorOutput}`));
      } else {
        const dirResults = Array.from(dirSet).map((dirPath) => ({
          relativePath: dirPath,
          isDirectory: true,
        }));

        const allResults = [...fileResults, ...dirResults];

        allResults.sort((a, b) => {
          const depthA = a.relativePath.split("/").length;
          const depthB = b.relativePath.split("/").length;
          if (depthA !== depthB) return depthA - depthB;
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.relativePath.localeCompare(b.relativePath);
        });

        resolve(allResults);
      }
    });

    rgProcess.on("error", (error) => {
      reject(new Error(`ripgrep process error: ${error.message}`));
    });
  });
}
