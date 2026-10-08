/**
 * What a conversation's live view knows (`live.ts` follows the stream into it): `reduce` folds each
 * event of `GET /admin/api/conversations/:id/events` into a `LiveState`. Pure: no React, no request.
 */

// Relative, not `@/`: scripts/dashboard.test.ts imports this module from outside the dashboard.
import type { ApiEvent, ApiTranscriptEntry } from "../../lib/admin-api.ts";
import type { AssistantMessage as Assistant, Message, RunningTool } from "../../lib/messages.ts";

export interface LiveState {
  connected: boolean;
  busy: boolean;
  /** The answer being written. */
  partial?: Assistant | undefined;
  tools: RunningTool[];
  /** The entries the stream announced, oldest first: the transcript's newest, maybe not read yet. */
  entries: ApiTranscriptEntry[];
  /** Answers whose partial a snapshot no longer had (written for good meanwhile), as last seen, oldest first. */
  ended: Assistant[];
  /** Bumped whenever the transcript or the cost changed: read them again. */
  changes: number;
}

export const INITIAL: LiveState = { connected: false, busy: false, tools: [], entries: [], ended: [], changes: 0 };

/** Answers ended kept: the transcript has the older ones by now. */
const KEPT_ENDED = 5;

export type Action = { type: "reset" } | { type: "connected" } | { type: "disconnected" } | { type: "event"; event: ApiEvent };

/** An entry as the transcript gives it (`GET …/transcript`): pi-durable's, its model messages. */
function entryOf(value: unknown): ApiTranscriptEntry | undefined {
  const entry = value as { id?: unknown; kind?: unknown; model?: unknown } | undefined;
  if (entry?.id === undefined) return undefined;
  return { id: String(entry.id), kind: String(entry.kind), messages: Array.isArray(entry.model) ? entry.model : [] };
}

/** The ones announced, the most recent kept: older ones are in the transcript read since. */
const KEPT_ENTRIES = 50;
const withEntry = (entries: ApiTranscriptEntry[], value: unknown): ApiTranscriptEntry[] => {
  const entry = entryOf(value);
  return entry === undefined || entries.some((each) => each.id === entry.id) ? entries : [...entries, entry].slice(-KEPT_ENTRIES);
};

type Change =
  | { type: "text_start" | "thinking_start" | "toolcall_start" | "block"; contentIndex: number; block: Assistant["content"][number] }
  | { type: "text_delta" | "thinking_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_delta" }
  | { type: "message"; message: Assistant };

function applyChanges(partial: Assistant | undefined, changes: Change[]): Assistant | undefined {
  let message = partial;
  for (const change of changes) {
    if (change.type === "message") {
      message = change.message;
      continue;
    }
    if (message === undefined || change.type === "toolcall_delta") continue;
    const content = [...message.content];
    if ("delta" in change) {
      const part = content[change.contentIndex];
      if (part?.type === "text" && change.type === "text_delta") content[change.contentIndex] = { ...part, text: part.text + change.delta };
      if (part?.type === "thinking" && change.type === "thinking_delta") content[change.contentIndex] = { ...part, thinking: part.thinking + change.delta };
    } else {
      content[change.contentIndex] = change.block;
    }
    message = { ...message, content };
  }
  return message;
}

type ToolOutput = { trimStart?: number; append?: string } | { set: string };

export function reduce(state: LiveState, action: Action): LiveState {
  if (action.type === "reset") return INITIAL;
  if (action.type === "connected") return { ...state, connected: true };
  if (action.type === "disconnected") return { ...state, connected: false };
  const event = action.event;
  const changed = { ...state, changes: state.changes + 1 };
  switch (event.type) {
    case "snapshot": {
      const generation = event.generation as { message?: Assistant } | undefined;
      const tools = (event.tools as { callId: string; name: string; status: string; output?: string }[] | undefined) ?? [];
      const partial = generation?.message;
      // The answer being written is gone from this snapshot: it ended, and is shown as it was until the transcript has it.
      const gone = state.partial !== undefined && partial?.timestamp !== state.partial.timestamp ? state.partial : undefined;
      return {
        ...changed,
        busy: event.run !== undefined,
        partial,
        ended: gone === undefined ? state.ended : [...state.ended, gone].slice(-KEPT_ENDED),
        tools: tools.filter((tool) => tool.status !== "done").map((tool) => ({ callId: tool.callId, name: tool.name, output: tool.output ?? "" })),
      };
    }
    case "run_start":
      return { ...state, busy: true };
    case "run_end":
      return { ...changed, busy: false, partial: undefined, tools: [] };
    case "message_start": {
      const message = event.message as Message;
      return message.role === "assistant" ? { ...state, partial: message } : state;
    }
    case "message_update":
      return { ...state, partial: applyChanges(state.partial, event.changes as Change[]) };
    case "message_end":
      return { ...changed, partial: undefined, entries: withEntry(state.entries, event.entry) };
    case "tool_execution_start":
      return { ...state, tools: [...state.tools, { callId: String(event.toolCallId), name: String(event.toolName), output: "" }] };
    case "tool_execution_update": {
      const output = event.output as ToolOutput | undefined;
      if (output === undefined) return state;
      return {
        ...state,
        tools: state.tools.map((tool) => {
          if (tool.callId !== event.toolCallId) return tool;
          if ("set" in output) return { ...tool, output: output.set };
          return { ...tool, output: tool.output.slice(output.trimStart ?? 0) + (output.append ?? "") };
        }),
      };
    }
    case "tool_execution_end":
      return { ...changed, tools: state.tools.filter((tool) => tool.callId !== event.toolCallId) };
    case "entry_appended":
      return { ...changed, entries: withEntry(state.entries, event.entry) };
    case "usage_changed":
      return changed;
    default:
      return state;
  }
}
