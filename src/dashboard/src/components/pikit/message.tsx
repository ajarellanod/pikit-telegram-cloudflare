/**
 * A transcript, in pi-ai's JSON (the runtime's own words, SPEC §5), as the chat shows it: a person's
 * message is a bubble; the agent's reply (its assistant messages and tool results up to the next
 * person's message) is its text, its thinking (ThinkingState) and its tool calls (ToolChips), in the
 * order they came. System messages (instructions, tools) are folded away.
 *
 * `turnsOf` builds that from the transcript and what is live (the answer being written, the tools
 * running); `UserBubble` and `Reply` show it (a person's images in the bubble). `MessageView` shows a
 * single message the same way.
 */

import type { ReactNode } from "react";
import LoadingState from "@/components/bui/LoadingState";
import { StatusPill } from "@/components/bui/StatusPill";
import { StreamText } from "@/components/bui/StreamText";
import ThinkingState from "@/components/bui/ThinkingState";
import ToolChips, { type ToolStatus, type ToolStep } from "@/components/bui/ToolChips";
import { OPERATOR_NOTE } from "@/lib/admin-api";

type Text = { type: "text"; text: string };
type Thinking = { type: "thinking"; thinking: string; redacted?: boolean };
type Image = { type: "image"; mimeType: string; data: string };
type ToolCall = { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export type Message =
  | { role: "system"; content?: unknown; timestamp?: number }
  | { role: "user"; content: string | (Text | Image)[]; timestamp?: number }
  | { role: "assistant"; content: (Text | Thinking | ToolCall)[]; stopReason?: string; errorMessage?: string; timestamp?: number }
  | { role: "toolResult"; toolCallId: string; toolName: string; content: (Text | Image)[]; isError?: boolean; timestamp?: number };

export type UserMessage = Extract<Message, { role: "user" }>;
export type AssistantMessage = Extract<Message, { role: "assistant" }>;
export type ToolResultMessage = Extract<Message, { role: "toolResult" }>;

/** A tool running now, from the live events (`live.ts`). */
export interface RunningTool {
  callId: string;
  name: string;
  output: string;
}

/** One tool call of a reply, with what became of it. */
export interface Call {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: ToolStatus;
  /** What it returned, or is returning. */
  output: string;
  /** Epoch ms: when its assistant message was written, and when its result came. */
  calledAt?: number;
  doneAt?: number;
}

export type Segment =
  | { kind: "text"; text: string; streaming: boolean }
  | { kind: "thinking"; text: string; redacted: boolean; streaming: boolean }
  | { kind: "tools"; calls: Call[] }
  | { kind: "error"; text: string }
  | { kind: "aborted" };

export type Turn = { kind: "user"; key: string; message: UserMessage } | { kind: "reply"; key: string; at?: number; segments: Segment[] };

export interface Live {
  busy: boolean;
  /** The answer being written. */
  partial?: AssistantMessage;
  tools: RunningTool[];
}

const textOf = (content: (Text | Image)[]): string => content.map((part) => (part.type === "text" ? part.text : `[image ${part.mimeType}]`)).join("\n");

/**
 * The turns of `messages` (oldest first) and what is live: the partial answer joins the last reply,
 * a tool call takes its result (or its running output) by id, and consecutive calls of one reply
 * share one group.
 */
export function turnsOf(messages: Message[], live: Live): Turn[] {
  const all = [...messages, ...(live.partial === undefined ? [] : [live.partial])];
  const results = new Map<string, ToolResultMessage>();
  for (const message of all) if (message.role === "toolResult") results.set(message.toolCallId, message);
  const running = new Map(live.tools.map((tool) => [tool.callId, tool]));
  const seen = new Set<string>();
  const turns: Turn[] = [];
  let reply: Extract<Turn, { kind: "reply" }> | undefined;

  const call = (id: string, name: string, args: Record<string, unknown>, calledAt: number | undefined): Call => {
    seen.add(id);
    const result = results.get(id);
    const tool = running.get(id);
    const status: ToolStatus = tool !== undefined ? "running" : result === undefined ? "none" : result.isError === true ? "failed" : "done";
    return { id, name, arguments: args, status, output: tool?.output ?? (result === undefined ? "" : textOf(result.content)), calledAt, doneAt: result?.timestamp };
  };
  const addCall = (target: Extract<Turn, { kind: "reply" }>, each: Call) => {
    const last = target.segments.at(-1);
    if (last?.kind === "tools") last.calls.push(each);
    else target.segments.push({ kind: "tools", calls: [each] });
  };
  const replyFor = (key: string, at: number | undefined) => {
    if (reply === undefined) {
      reply = { kind: "reply", key, at, segments: [] };
      turns.push(reply);
    }
    return reply;
  };

  for (const [i, message] of all.entries()) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      reply = undefined;
      turns.push({ kind: "user", key: `u${i}`, message });
      continue;
    }
    const target = replyFor(`r${i}`, message.timestamp);
    if (message.role === "toolResult") {
      // Its call is on an older page: shown on its own.
      if (!seen.has(message.toolCallId)) addCall(target, call(message.toolCallId, message.toolName, {}, undefined));
      continue;
    }
    const streaming = message === live.partial;
    for (const [j, part] of message.content.entries()) {
      const last = streaming && j === message.content.length - 1;
      if (part.type === "text") {
        if (part.text.trim() !== "" || last) target.segments.push({ kind: "text", text: part.text, streaming: last });
      } else if (part.type === "thinking") {
        target.segments.push({ kind: "thinking", text: part.thinking, redacted: part.redacted === true, streaming: last });
      } else {
        addCall(target, call(part.id, part.name, part.arguments ?? {}, message.timestamp));
      }
    }
    if (message.errorMessage !== undefined) target.segments.push({ kind: "error", text: message.errorMessage });
    if (message.stopReason === "aborted") target.segments.push({ kind: "aborted" });
  }

  // A tool running whose call is not here yet: the last reply's.
  for (const tool of live.tools) {
    if (!seen.has(tool.callId)) addCall(replyFor(`live-${tool.callId}`, undefined), call(tool.callId, tool.name, {}, undefined));
  }
  // A call without a result while the run goes is waiting for its turn.
  const lastReply = turns.at(-1);
  if (live.busy && lastReply?.kind === "reply") {
    for (const segment of lastReply.segments) if (segment.kind === "tools") for (const each of segment.calls) if (each.status === "none") each.status = "waiting";
  }
  return turns;
}

const stringArg = (args: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
};

/** How a call reads: its glyph, a short label, and what it was called on. */
export function describeCall(name: string, args: Record<string, unknown>): Pick<ToolStep, "icon" | "label" | "chip" | "mono"> {
  switch (name) {
    case "read":
      return { icon: "read", label: "Read", chip: stringArg(args, "path"), mono: true };
    case "write": {
      const content = stringArg(args, "content");
      const lines = content === undefined ? undefined : content.split("\n").length;
      return { icon: "write", label: lines === undefined ? "Write" : `Write ${lines} line${lines === 1 ? "" : "s"}`, chip: stringArg(args, "path"), mono: true };
    }
    case "edit":
      return { icon: "write", label: "Edit", chip: stringArg(args, "path"), mono: true };
    case "bash":
      return { icon: "run", label: "Run", chip: stringArg(args, "command"), mono: true };
    default: {
      const first = Object.values(args).find((value) => typeof value === "string" && value !== "") as string | undefined;
      const json = JSON.stringify(args);
      return { icon: "tool", label: name, chip: first ?? (json === "{}" ? undefined : json), mono: true };
    }
  }
}

function toolsHeader(calls: Call[]): string {
  const count = (status: ToolStatus) => calls.filter((each) => each.status === status).length;
  const parts = [`${calls.length} tool call${calls.length === 1 ? "" : "s"}`];
  if (count("running") > 0) parts.push(`${count("running")} running`);
  if (count("failed") > 0) parts.push(`${count("failed")} failed`);
  return parts.join(", ");
}

/** A person's message: in one of the dashboard's own words, the operator's note line is folded away. */
export function userText(message: UserMessage): { text: string; operator: boolean; images: Image[] } {
  const text = typeof message.content === "string" ? message.content : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const images = typeof message.content === "string" ? [] : message.content.filter((part): part is Image => part.type === "image");
  if (!text.startsWith(OPERATOR_NOTE)) return { text, operator: false, images };
  const newline = text.indexOf("\n");
  return { text: newline === -1 ? "" : text.slice(newline + 1), operator: true, images };
}

/** A person's message, at the right. `from` names who wrote it when it was not the operator. */
export function UserBubble({ message, from }: { message: UserMessage; from?: string }) {
  const { text, operator, images } = userText(message);
  return (
    <div className="flex flex-col items-end gap-1 pl-10 sm:pl-24" style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}>
      {!operator && from !== undefined && <span className="px-1 text-[11.5px] font-medium text-ink-3">{from}</span>}
      {images.length > 0 && (
        <div className="flex max-w-full flex-wrap justify-end gap-2">
          {images.map((image, i) => (
            <img key={i} className="max-h-56 max-w-[min(100%,320px)] rounded-xl object-contain shadow-hairline" alt={`Image ${i + 1}`} src={`data:${image.mimeType};base64,${image.data}`} />
          ))}
        </div>
      )}
      {text !== "" && (
        <div className="max-w-full rounded-xl bg-field px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink shadow-hairline [overflow-wrap:anywhere]">{text}</div>
      )}
    </div>
  );
}

/** The agent's reply: its segments in order; `waiting` while the run goes and nothing is being written. */
export function Reply({ segments, waiting, since }: { segments: Segment[]; waiting?: boolean; since?: number }) {
  const blocks: ReactNode[] = segments.map((segment, i) => {
    switch (segment.kind) {
      case "text":
        return (
          <p key={i} className="max-w-[640px] text-[13.5px] leading-[1.65] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
            <StreamText text={segment.text} streaming={segment.streaming} />
          </p>
        );
      case "thinking":
        return segment.redacted ? (
          <ThinkingState key={i} text="" working={segment.streaming} done="Thought (redacted)" />
        ) : (
          <ThinkingState key={i} text={segment.text} working={segment.streaming} />
        );
      case "tools":
        return (
          <ToolChips
            key={i}
            header={toolsHeader(segment.calls)}
            steps={segment.calls.map((each) => ({ id: each.id, ...describeCall(each.name, each.arguments), status: each.status, detail: each.output }))}
          />
        );
      case "error":
        return (
          <p key={i} className="max-w-[640px] rounded-card bg-red-tint px-3 py-2 text-[13px] text-red [overflow-wrap:anywhere]">
            {segment.text}
          </p>
        );
      case "aborted":
        return (
          <div key={i}>
            <StatusPill tone="neutral">Stopped</StatusPill>
          </div>
        );
    }
  });
  return (
    <article className="flex min-w-0 flex-col gap-4" style={{ animation: "fade-up 450ms cubic-bezier(0.23,1,0.32,1) both" }}>
      {blocks}
      {waiting === true && (
        <div className="flex min-h-6 items-center" style={{ animation: "fade-in 200ms ease-out both" }}>
          <LoadingState label="Thinking" variant="Dots" since={since} />
        </div>
      )}
    </article>
  );
}

/** One message on its own: a bubble, or a reply of one message. */
export function MessageView({ message, streaming = false }: { message: Message; streaming?: boolean }) {
  if (message.role === "system") return null;
  if (message.role === "user") return <UserBubble message={message} />;
  const live = streaming && message.role === "assistant";
  const [turn] = live ? turnsOf([], { busy: true, tools: [], partial: message }) : turnsOf([message], { busy: false, tools: [] });
  return turn?.kind === "reply" ? <Reply segments={turn.segments} /> : null;
}
