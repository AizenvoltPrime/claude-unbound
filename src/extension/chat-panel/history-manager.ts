import * as vscode from "vscode";
import { extractSlashCommandDisplay } from "../../shared/utils";
import { loadSkillDescription } from "../skills/utils";
import {
  readSessionEntriesPaginated,
  readActiveBranchEntries,
  readAgentData,
  extractSessionStats,
  findUserTextBlock,
  findUserImageBlocks,
  type AgentData,
  type JsonlContentBlock,
  type ClaudeSessionEntry,
} from "../session";
import {
  FEEDBACK_MARKER,
  type ExtensionToWebviewMessage,
  type HistoryMessage,
  type HistoryToolCall,
  type RewindHistoryItem,
  type ContentBlock,
} from "../../shared/types";
import { HISTORY_PAGE_SIZE, TOOL_RESULT_MAX_LENGTH } from "./types";
import { log } from "../logger";

export interface HistoryManagerConfig {
  workspacePath: string;
  postMessage: (panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage) => void;
}

interface ToolResultData {
  result: string;
  agentId?: string;
  isError?: boolean;
  feedback?: string;
}

interface ExtractedContent {
  textContent: string;
  thinkingContent: string;
  tools: HistoryToolCall[];
}

type ValidMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const VALID_MEDIA_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function isValidMediaType(mediaType: string): mediaType is ValidMediaType {
  return VALID_MEDIA_TYPES.has(mediaType);
}

function extractDisplayableUserContent(msgContent: unknown): string | null {
  let content = "";

  if (typeof msgContent === "string") {
    content = msgContent;
  } else if (Array.isArray(msgContent)) {
    const textBlock = findUserTextBlock(msgContent as JsonlContentBlock[]);
    content = textBlock?.text ?? "";
  }

  if (!content || content.startsWith("<local-command-")) {
    return null;
  }

  if (content.startsWith("<command-")) {
    const displayContent = extractSlashCommandDisplay(content);
    return displayContent?.toLowerCase().startsWith("/compact") ? null : displayContent;
  }

  return content.toLowerCase().startsWith("/compact") ? null : content;
}

export class HistoryManager {
  private readonly workspacePath: string;
  private readonly postMessage: HistoryManagerConfig["postMessage"];

  constructor(config: HistoryManagerConfig) {
    this.workspacePath = config.workspacePath;
    this.postMessage = config.postMessage;
  }

  async loadSessionHistory(sessionId: string, panel: vscode.WebviewPanel): Promise<void> {
    this.postMessage(panel, { type: "sessionCleared" });

    log(`[HistoryManager] loadSessionHistory: sessionId=${sessionId}`);
    const result = await readSessionEntriesPaginated(this.workspacePath, sessionId, 0, HISTORY_PAGE_SIZE);
    log(`[HistoryManager] readSessionEntriesPaginated result: entries=${result.entries.length}, hasCompactInfo=${!!result.compactInfo}`);

    if (result.compactInfo) {
      log(`[HistoryManager] sending compactBoundary: trigger=${result.compactInfo.trigger}, hasSummary=${!!result.compactInfo.summary}, summaryLength=${result.compactInfo.summary?.length ?? 0}`);
      this.postMessage(panel, {
        type: "compactBoundary",
        preTokens: result.compactInfo.preTokens,
        trigger: result.compactInfo.trigger,
        summary: result.compactInfo.summary,
        timestamp: result.compactInfo.timestamp,
        isHistorical: true,
      });
    } else {
      log(`[HistoryManager] no compactInfo found`);
    }

    const messages = await this.convertEntriesToMessages(result.entries, result.injectedUuids);

    for (const msg of messages) {
      if (msg.type === "user") {
        this.postMessage(panel, {
          type: "userReplay",
          content: msg.content,
          contentBlocks: msg.contentBlocks,
          isSynthetic: false,
          sdkMessageId: msg.sdkMessageId,
          isInjected: msg.isInjected,
        });
      } else if (msg.type === "error") {
        this.postMessage(panel, {
          type: "errorReplay",
          content: msg.content,
        });
      } else {
        this.postMessage(panel, {
          type: "assistantReplay",
          content: msg.content,
          thinking: msg.thinking,
          tools: msg.tools,
        });
      }
    }

    try {
      const stats = await extractSessionStats(this.workspacePath, sessionId);
      if (stats) {
        this.postMessage(panel, {
          type: "tokenUsageUpdate",
          inputTokens: stats.totalInputTokens,
          cacheCreationTokens: stats.cacheCreationTokens,
          cacheReadTokens: stats.cacheReadTokens,
        });
        this.postMessage(panel, {
          type: "done",
          data: {
            type: "result",
            session_id: sessionId,
            is_done: true,
            total_output_tokens: stats.totalOutputTokens,
            num_turns: stats.numTurns,
            context_window_size: stats.contextWindowSize,
          },
        });
      }
    } catch {
      // Stats extraction failed - session will load without stats
    }

    if (result.hasMore) {
      this.postMessage(panel, {
        type: "historyChunk",
        messages: [],
        hasMore: true,
        nextOffset: result.nextOffset,
      });
    }
  }

  async loadMoreHistory(sessionId: string, offset: number, panel: vscode.WebviewPanel): Promise<void> {
    const result = await readSessionEntriesPaginated(this.workspacePath, sessionId, offset, HISTORY_PAGE_SIZE);
    const messages = await this.convertEntriesToMessages(result.entries, result.injectedUuids);

    this.postMessage(panel, {
      type: "historyChunk",
      messages,
      hasMore: result.hasMore,
      nextOffset: result.nextOffset,
    });
  }

  async extractRewindHistory(sessionId: string, conversationHead?: string | null): Promise<RewindHistoryItem[]> {
    const entries = await readActiveBranchEntries(this.workspacePath, sessionId, conversationHead ?? undefined);
    const history: RewindHistoryItem[] = [];

    for (const entry of entries) {
      if (entry.type !== "user" || !entry.uuid || entry.isMeta || entry.isCompactSummary) continue;

      const content = extractDisplayableUserContent(entry.message?.content);
      if (!content) continue;

      if (entry.isInterrupt || content.startsWith("[Request interrupted by user")) {
        continue;
      }

      history.push({
        messageId: entry.uuid,
        content: content.slice(0, 200),
        timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
        filesAffected: 0,
      });
    }

    return history.reverse();
  }

  async convertEntriesToMessages(entries: ClaudeSessionEntry[], injectedUuids?: Set<string>): Promise<HistoryMessage[]> {
    const toolResults = this.collectToolResults(entries);
    const taskToolAgents = this.collectTaskToolAgents(entries);
    const skillToolNames = this.collectSkillToolNames(entries);
    const agentDataMap = await this.loadAgentDataForTools(taskToolAgents);
    const skillDescriptions = await this.loadSkillDescriptions(skillToolNames);

    return this.buildMessages(entries, toolResults, taskToolAgents, agentDataMap, skillDescriptions, injectedUuids);
  }

  private collectToolResults(entries: ClaudeSessionEntry[]): Map<string, ToolResultData> {
    const toolResults = new Map<string, ToolResultData>();

    for (const entry of entries) {
      if (entry.type === "user" && entry.message && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content as JsonlContentBlock[]) {
          if (block.type === "tool_result") {
            const isError = block.is_error === true;
            if (this.shouldUseToolUseResultAsDisplay(entry.toolUseResult)) {
              toolResults.set(block.tool_use_id, {
                result: JSON.stringify(entry.toolUseResult),
                agentId: entry.toolUseResult?.agentId,
                isError,
              });
            } else {
              const rawResult = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
              const result = rawResult.length > TOOL_RESULT_MAX_LENGTH
                ? rawResult.slice(0, TOOL_RESULT_MAX_LENGTH) + "... (truncated)"
                : rawResult;

              let feedback: string | undefined;
              if (isError && rawResult.includes(FEEDBACK_MARKER)) {
                const markerIndex = rawResult.indexOf(FEEDBACK_MARKER);
                feedback = rawResult.slice(markerIndex + FEEDBACK_MARKER.length).trim();
              }

              toolResults.set(block.tool_use_id, { result, isError, feedback });
            }
          }
        }
      }
    }

    return toolResults;
  }

  private shouldUseToolUseResultAsDisplay(
    toolUseResult: ClaudeSessionEntry["toolUseResult"]
  ): boolean {
    if (!toolUseResult) return false;
    return (
      toolUseResult.totalDurationMs !== undefined ||
      toolUseResult.answers !== undefined
    );
  }

  private collectTaskToolAgents(entries: ClaudeSessionEntry[]): Map<string, string> {
    const taskToolAgents = new Map<string, string>();

    for (const entry of entries) {
      if (entry.type === "user" && entry.message && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content as JsonlContentBlock[]) {
          if (block.type === "tool_result" && entry.toolUseResult?.agentId) {
            taskToolAgents.set(block.tool_use_id, entry.toolUseResult.agentId);
          }
        }
      }
    }

    return taskToolAgents;
  }

  private async loadAgentDataForTools(taskToolAgents: Map<string, string>): Promise<Map<string, AgentData>> {
    const agentDataMap = new Map<string, AgentData>();

    await Promise.all(
      Array.from(taskToolAgents.entries()).map(async ([toolUseId, agentId]) => {
        const agentData = await readAgentData(this.workspacePath, agentId);
        agentDataMap.set(toolUseId, agentData);
      })
    );

    return agentDataMap;
  }

  private collectSkillToolNames(entries: ClaudeSessionEntry[]): Set<string> {
    const skillNames = new Set<string>();

    for (const entry of entries) {
      if (entry.type === "assistant" && entry.message && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content as JsonlContentBlock[]) {
          if (block.type === "tool_use" && block.name === "Skill") {
            const skillName = typeof block.input?.skill === "string" ? block.input.skill : null;
            if (skillName) {
              skillNames.add(skillName);
            }
          }
        }
      }
    }

    return skillNames;
  }

  private async loadSkillDescriptions(skillNames: Set<string>): Promise<Map<string, string>> {
    const descriptions = new Map<string, string>();

    await Promise.all(
      Array.from(skillNames).map(async (skillName) => {
        const description = await loadSkillDescription(skillName);
        if (description) {
          descriptions.set(skillName, description);
        }
      })
    );

    return descriptions;
  }

  private extractContentFromEntry(
    entry: ClaudeSessionEntry,
    toolResults: Map<string, ToolResultData>,
    taskToolAgents: Map<string, string>,
    agentDataMap: Map<string, AgentData>,
    skillDescriptions: Map<string, string>
  ): ExtractedContent {
    const msgContent = entry.message?.content;
    let textContent = "";
    let thinkingContent = "";
    const tools: HistoryToolCall[] = [];

    if (typeof msgContent === "string") {
      textContent = msgContent;
    } else if (Array.isArray(msgContent)) {
      const blocks = msgContent as JsonlContentBlock[];

      textContent = blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");

      thinkingContent = blocks
        .filter((b): b is { type: "thinking"; thinking: string } => b.type === "thinking" && typeof b.thinking === "string")
        .map((b) => b.thinking)
        .join("\n\n");

      for (const block of blocks) {
        if (block.type === "tool_use") {
          const tool: HistoryToolCall = {
            id: block.id,
            name: block.name,
            input: block.input,
          };

          const resultData = toolResults.get(block.id);
          if (resultData) {
            tool.result = resultData.result;
            tool.isError = resultData.isError;
            tool.feedback = resultData.feedback;
          }

          const agentId = taskToolAgents.get(block.id);
          if (agentId) {
            tool.sdkAgentId = agentId;
            const agentData = agentDataMap.get(block.id);
            if (agentData) {
              if (agentData.toolCalls.length > 0) {
                tool.agentToolCalls = agentData.toolCalls;
              }
              if (agentData.model) {
                tool.agentModel = agentData.model;
              }
            }
          }

          if (block.name === "Skill") {
            const skillName = typeof block.input?.skill === "string" ? block.input.skill : null;
            if (skillName) {
              const description = skillDescriptions.get(skillName);
              if (description) {
                tool.metadata = { skillDescription: description };
              }
            }
          }

          tools.push(tool);
        }
      }
    }

    return { textContent, thinkingContent, tools };
  }

  private buildMessages(
    entries: ClaudeSessionEntry[],
    toolResults: Map<string, ToolResultData>,
    taskToolAgents: Map<string, string>,
    agentDataMap: Map<string, AgentData>,
    skillDescriptions: Map<string, string>,
    injectedUuids?: Set<string>
  ): HistoryMessage[] {
    const messages: HistoryMessage[] = [];

    for (const entry of entries) {
      if (entry.type === "user" && entry.message && !entry.isMeta && !entry.isCompactSummary && !entry.isVisibleInTranscriptOnly) {
        const isInjectedFromBranch = entry.uuid ? injectedUuids?.has(entry.uuid) : false;
        const isInjected = entry.isInjected || isInjectedFromBranch;
        const userMessage = this.buildUserMessage(entry, isInjected);
        if (userMessage) {
          messages.push(userMessage);
        }
      } else if (entry.type === "assistant" && entry.message) {
        const assistantMessage = this.buildAssistantMessage(entry, toolResults, taskToolAgents, agentDataMap, skillDescriptions);
        if (assistantMessage) {
          messages.push(assistantMessage);
        }
      }
    }

    return messages;
  }

  private buildUserMessage(entry: ClaudeSessionEntry, isInjected?: boolean): HistoryMessage | null {
    const content = extractDisplayableUserContent(entry.message?.content);
    if (!content) return null;

    if (content.startsWith("Unknown slash command:") || content.startsWith("Caveat:")) {
      return null;
    }

    if (entry.isInterrupt || content.startsWith("[Request interrupted by user")) {
      return { type: "error", content: "Claude Code process aborted by user" };
    }

    const sdkMessageId = entry.uuid;

    let contentBlocks: ContentBlock[] | undefined;
    const msgContent = entry.message?.content;
    if (Array.isArray(msgContent)) {
      const imageBlocks = findUserImageBlocks(msgContent as JsonlContentBlock[]);
      if (imageBlocks.length > 0) {
        const textBlock = findUserTextBlock(msgContent as JsonlContentBlock[]);
        const validImages = imageBlocks.filter(img => isValidMediaType(img.source.media_type));
        contentBlocks = [
          ...validImages.map(img => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: img.source.media_type as ValidMediaType,
              data: img.source.data,
            },
          })),
          ...(textBlock ? [{ type: "text" as const, text: textBlock.text }] : []),
        ];
      }
    }

    return { type: "user", content, contentBlocks, sdkMessageId, isInjected };
  }

  private buildAssistantMessage(
    entry: ClaudeSessionEntry,
    toolResults: Map<string, ToolResultData>,
    taskToolAgents: Map<string, string>,
    agentDataMap: Map<string, AgentData>,
    skillDescriptions: Map<string, string>
  ): HistoryMessage | null {
    const { textContent, thinkingContent, tools } = this.extractContentFromEntry(
      entry,
      toolResults,
      taskToolAgents,
      agentDataMap,
      skillDescriptions
    );

    if (!textContent && !thinkingContent && tools.length === 0) {
      return null;
    }

    if (textContent === "No response requested." && tools.length === 0) {
      return null;
    }

    return {
      type: "assistant",
      content: textContent,
      thinking: thinkingContent || undefined,
      tools: tools.length > 0 ? tools : undefined,
    };
  }
}
