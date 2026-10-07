/**
 * The Worker's calls to the objects, on Cloudflare (`actor.mailbox.call`, answered with
 * `actor.inbox.answer` in each object's App), and what each object answers with: its own
 * conversations, read and acted on through the local backend (`backend.ts`), with its own ids. The
 * Worker (`remote.ts`) qualifies them.
 *
 * | Type | Message | Answer |
 * |---|---|---|
 * | `admin-api.app` | — | `ApiApp`: this App's composition, secrets redacted |
 * | `admin-api.agents` | — | `ApiAgents`: this App's agents |
 * | `admin-api.conversation` | `{ conversationId }` | `ApiConversation` |
 * | `admin-api.transcript` | `{ conversationId, limit?, cursor? }` | `ApiPage<ApiTranscriptEntry>`, fewer entries than `limit` when they would not fit in an answer (`ANSWER_CHARS`) |
 * | `admin-api.snapshot` | `{ conversationId }` | `ApiEvent`: the first event of its live events |
 * | `admin-api.usage` | `{ conversationId }` | `ApiUsage` |
 * | `admin-api.message` | `{ conversationId, text, requestId, attachments?, webSearch? }` | `{ requestId, admission }`: the operator's follow-up |
 * | `admin-api.start` | `{ agent, text, requestId, attachments?, webSearch? }`, to the object of a `dashboard:` key | `ApiStartResponse`: the dashboard's own conversation |
 * | `admin-api.abort` | `{ conversationId }` | `{ conversationId }` |
 * | `admin-api.reset` | `{ conversationId }` | `ApiResetResponse` |
 * | `admin-api.commands` | — | `ApiCommands`: this App's slash commands |
 * | `admin-api.command` | `{ conversationId, name, args }` | `ApiCommandResponse`: the command run in the conversation |
 * | `admin-api.list` | `{ limit, cursor?, archived? }` | `IndexPage` (the index object's) |
 * | `admin-api.hide` | `{ key, conversationId, how? }` (`archived`, `deleted`; absent: back in the list) | `{}` (the index object's; `not_found` when it has no such conversation) |
 *
 * And one message (`send`, `actor.inbox.handle`): `admin-api.seen` `{ entries: [{ key,
 * conversationId, agent, at }] }`, to the index.
 *
 * A refusal is an `ActorCallError` (`not_found`, `no_agent`, `not_current`, `invalid_cursor`,
 * `invalid_request`, `unknown_agent`, `too_large`, `unknown_command`, `command_failed`), whose code
 * crosses the call.
 *
 * **Sizes.** A call carries at most 32 MiB each way (Workers RPC). A message's images are at most
 * `MAX_DURABLE_IMAGE_BYTES` there (the Worker checks, `remote.ts`; the object again), and a transcript
 * page that holds images is answered shorter until it fits in `ANSWER_CHARS`: its `next` reads on.
 */

import { type ActorInbox, ActorCallError, type JsonValue, type PageRequest } from "@pikit/contracts";
import { type ApiAttachment, attachmentsProblem } from "./api.ts";
import { type AdminBackend, type Message, refusal } from "./backend.ts";
import type { ConversationIndex, IndexedConversation } from "./conversation-index.ts";

export const CALL = {
  app: "admin-api.app",
  agents: "admin-api.agents",
  conversation: "admin-api.conversation",
  transcript: "admin-api.transcript",
  snapshot: "admin-api.snapshot",
  usage: "admin-api.usage",
  message: "admin-api.message",
  start: "admin-api.start",
  abort: "admin-api.abort",
  reset: "admin-api.reset",
  commands: "admin-api.commands",
  command: "admin-api.command",
  list: "admin-api.list",
  hide: "admin-api.hide",
} as const;

/** The message each conversation's object sends the index. */
export const SEEN = "admin-api.seen";

/** The largest page of `admin-api.list`, and of a transcript read through a call. */
export const LIST_MAX = 500;
/** Entries of one `seen` at most. */
const SEEN_MAX = 100;
/** The longest answer a transcript call makes, in JSON characters: well under what a call carries (32 MiB). */
export const ANSWER_CHARS = 16 * 1024 * 1024;

type Fields = Record<string, unknown>;

const fieldsOf = (message: JsonValue): Fields => (typeof message === "object" && message !== null && !Array.isArray(message) ? (message as Fields) : {});

const text = (message: JsonValue, field: string): string => {
  const value = fieldsOf(message)[field];
  if (typeof value !== "string" || value === "") throw refusal("invalid_request", `admin-api: "${field}" is a non-empty string`);
  return value;
};

const pageOf = (message: JsonValue): PageRequest => {
  const { limit, cursor } = fieldsOf(message);
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > LIST_MAX)) {
    throw refusal("invalid_request", `admin-api: "limit" is an integer from 1 to ${LIST_MAX}`);
  }
  if (cursor !== undefined && typeof cursor !== "string") throw refusal("invalid_request", 'admin-api: "cursor" is a string');
  return { ...(limit !== undefined && { limit }), ...(cursor !== undefined && { cursor }) };
};

const seenOf = (message: JsonValue): IndexedConversation[] => {
  const entries = fieldsOf(message).entries;
  if (!Array.isArray(entries) || entries.length > SEEN_MAX) throw new ActorCallError("invalid_request", `admin-api: "entries" is a list of at most ${SEEN_MAX}`);
  return entries.map((entry) => {
    const at = fieldsOf(entry).at;
    if (typeof at !== "number" || !Number.isFinite(at)) throw new ActorCallError("invalid_request", 'admin-api: "at" is epoch milliseconds');
    return { key: text(entry, "key"), conversationId: text(entry, "conversationId"), agent: text(entry, "agent"), at };
  });
};

const json = (value: unknown): JsonValue => value as JsonValue;

/** The message of a `message` or `start` call: its text and request id, its images checked again (the object's own limit), whether it asks for a web search. */
function messageOf(message: JsonValue): Message {
  const fields = fieldsOf(message);
  const written = fields.text;
  if (typeof written !== "string") throw refusal("invalid_request", 'admin-api: "text" is a string');
  const { attachments, webSearch } = fields;
  if (attachments !== undefined && !(Array.isArray(attachments) && attachments.every((each) => typeof fieldsOf(each).data === "string" && typeof fieldsOf(each).mimeType === "string"))) {
    throw refusal("invalid_request", 'admin-api: "attachments" is a list of images');
  }
  const images = (attachments ?? []) as ApiAttachment[];
  const wrong = attachmentsProblem(images, "durable");
  if (wrong !== undefined) throw refusal(wrong.status === 413 ? "too_large" : "invalid_request", `admin-api: ${wrong.message}`);
  if (webSearch !== undefined && typeof webSearch !== "boolean") throw refusal("invalid_request", 'admin-api: "webSearch" is a boolean');
  return { text: written, requestId: text(message, "requestId"), ...(images.length > 0 && { attachments: images }), ...(webSearch === true && { webSearch }) };
}

/**
 * Registers the object's answers to the Worker's calls over `backendOf(key)` (this object's own, `key`
 * its key), and the index's (`index`: used only in the index object, but every object can answer).
 * Call it in `start`.
 */
export function answerCalls(inbox: ActorInbox, backendOf: (key: string) => AdminBackend, index: ConversationIndex): void {
  const id = (message: JsonValue) => text(message, "conversationId");

  inbox.answer(CALL.app, async (key, _message, ctx) => json(await backendOf(key).app(ctx)));
  inbox.answer(CALL.agents, async (key, _message, ctx) => json(await backendOf(key).agents(ctx)));
  inbox.answer(CALL.conversation, async (key, message, ctx) => json(await backendOf(key).conversation(id(message), ctx)));
  // A page too long for an answer (images inline) is read again, half as long, until it fits.
  inbox.answer(CALL.transcript, async (key, message, ctx) => {
    const page = pageOf(message);
    let limit = page.limit ?? 50;
    for (;;) {
      const read = await backendOf(key).transcript(id(message), { ...page, limit }, ctx);
      if (limit === 1 || JSON.stringify(read).length <= ANSWER_CHARS) return json(read);
      limit = Math.max(1, Math.floor(limit / 2));
    }
  });
  inbox.answer(CALL.snapshot, async (key, message, ctx) => json(await backendOf(key).snapshot(id(message), ctx)));
  inbox.answer(CALL.usage, async (key, message, ctx) => json(await backendOf(key).usage(id(message), ctx)));
  inbox.answer(CALL.message, async (key, message, ctx) => {
    const sent = await backendOf(key).send(id(message), messageOf(message), ctx);
    return { requestId: sent.requestId, admission: sent.admission };
  });
  inbox.answer(CALL.start, async (key, message, ctx) => json(await backendOf(key).start({ key, agent: text(message, "agent"), ...messageOf(message) }, ctx)));
  inbox.answer(CALL.abort, async (key, message, ctx) => ({ conversationId: (await backendOf(key).abort(id(message), ctx)).conversationId }));
  inbox.answer(CALL.reset, async (key, message, ctx) => json(await backendOf(key).reset(id(message), ctx)));
  inbox.answer(CALL.commands, async (key, _message, ctx) => json(await backendOf(key).commands(ctx)));
  inbox.answer(CALL.command, async (key, message, ctx) => {
    const { args } = fieldsOf(message);
    if (args !== undefined && typeof args !== "string") throw refusal("invalid_request", 'admin-api: "args" is a string');
    const { text: note } = await backendOf(key).command(id(message), text(message, "name"), args ?? "", ctx);
    return note === undefined ? {} : { text: note };
  });

  inbox.handle(SEEN, async (_key, message) => index.seen(seenOf(message)));
  inbox.answer(CALL.list, async (_key, message) => {
    const page = pageOf(message);
    const archived = fieldsOf(message).archived === true;
    return json(await index.list({ limit: page.limit ?? 50, archived, ...(page.cursor !== undefined && { cursor: page.cursor }) }));
  });
  inbox.answer(CALL.hide, async (_key, message) => {
    const how = fieldsOf(message).how;
    if (how !== undefined && how !== "archived" && how !== "deleted") throw refusal("invalid_request", 'admin-api: "how" is "archived" or "deleted"');
    if (!(await index.hide(text(message, "key"), text(message, "conversationId"), how))) throw refusal("not_found", "the index has no such conversation");
    return {};
  });
}
