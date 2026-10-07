/**
 * A conversation live, from its server-sent events (`GET /admin/api/conversations/:id/events`): whether
 * a run is going, the answer being written, the tools running. The stream starts with a `snapshot`
 * and a client that fell behind gets a new one, so the state is rebuilt from each snapshot, never from
 * a count of events. What is written for good (entries) is read from the transcript again: `changes`
 * counts the times it changed.
 *
 * The stream is open only while the dashboard is active (`useActive`: the tab visible, the operator
 * there in the last minutes); it reconnects when it ends (on Cloudflare after a bounded number of
 * polled snapshots) and when the operator comes back.
 */

import { useEffect, useReducer } from "react";
import { useActive } from "@/lib/activity";
import { type ApiEvent, follow } from "@/lib/api";
import type { AssistantMessage as Assistant, Message, RunningTool } from "@/components/pikit/message";

export type { RunningTool };

export interface LiveState {
  connected: boolean;
  busy: boolean;
  /** The answer being written. */
  partial?: Assistant;
  tools: RunningTool[];
  /** Bumped whenever the transcript or the cost changed: read them again. */
  changes: number;
}

const INITIAL: LiveState = { connected: false, busy: false, tools: [], changes: 0 };

type Action = { type: "connected" } | { type: "disconnected" } | { type: "event"; event: ApiEvent };

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

function reduce(state: LiveState, action: Action): LiveState {
  if (action.type === "connected") return { ...state, connected: true };
  if (action.type === "disconnected") return { ...state, connected: false };
  const event = action.event;
  const changed = { ...state, changes: state.changes + 1 };
  switch (event.type) {
    case "snapshot": {
      const generation = event.generation as { message?: Assistant } | undefined;
      const tools = (event.tools as { callId: string; name: string; status: string; output?: string }[] | undefined) ?? [];
      return {
        ...changed,
        busy: event.run !== undefined,
        partial: generation?.message,
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
      return { ...changed, partial: undefined };
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
    case "usage_changed":
      return changed;
    default:
      return state;
  }
}

/** Follows conversation `id` live while mounted and active, reconnecting after a dropped stream. */
export function useLive(id: string): LiveState & { paused: boolean } {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const active = useActive();

  useEffect(() => {
    if (!active) return;
    const stop = new AbortController();
    void (async () => {
      while (!stop.signal.aborted) {
        try {
          const started = follow(`/conversations/${encodeURIComponent(id)}/events`, (event) => dispatch({ type: "event", event }), stop.signal);
          dispatch({ type: "connected" });
          await started;
        } catch {
          // Reconnect below.
        }
        // A stream stopped by this cleanup says nothing: the next one (another id, or a return) owns the state.
        if (stop.signal.aborted) return;
        dispatch({ type: "disconnected" });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    })();
    return () => stop.abort();
  }, [id, active]);

  return { ...state, paused: !active };
}
