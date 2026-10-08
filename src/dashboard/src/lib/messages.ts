/**
 * A transcript's messages in pi-ai's JSON (the runtime's own words, SPEC §5), as the API gives them,
 * and a tool running now: the types `components/pikit/message.tsx` shows and `live-state.ts` folds.
 * Types only.
 */

export type Text = { type: "text"; text: string };
export type Thinking = { type: "thinking"; thinking: string; redacted?: boolean };
export type Image = { type: "image"; mimeType: string; data: string };
export type ToolCall = { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

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
