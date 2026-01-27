import { FEEDBACK_MARKER } from "@shared/types/constants";
import type { ToolCall } from "@shared/types/session";
import type { HistoryToolCall } from "@shared/types/content";

export function extractUserDenialFeedback(errorMessage: string): string | undefined {
  if (!errorMessage.includes(FEEDBACK_MARKER)) return undefined;
  const markerIndex = errorMessage.indexOf(FEEDBACK_MARKER);
  return errorMessage.slice(markerIndex + FEEDBACK_MARKER.length).trim();
}

export function convertHistoryTools(tools: HistoryToolCall[] | undefined): ToolCall[] | undefined {
  return tools?.map((t) => ({
    id: t.id,
    name: t.name,
    input: t.input,
    status: t.isError ? ("denied" as const) : ("completed" as const),
    result: t.result,
    isError: t.isError,
    metadata: t.metadata,
    feedback: t.feedback,
  }));
}
