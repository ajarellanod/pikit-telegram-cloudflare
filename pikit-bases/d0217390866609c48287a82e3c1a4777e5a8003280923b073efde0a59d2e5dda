/**
 * The admin API's JSON: what every route of admin-api answers, typed. The dashboard (`src/dashboard/`,
 * a project of its own) keeps an identical copy, `src/dashboard/src/lib/admin-api.ts`: no imports, so
 * it compiles there too. Change both together; the kit's tests check they are the same.
 *
 * Every route needs an operator (`admin.auth`): `Authorization: Bearer <PIKIT_ADMIN_TOKEN>` with
 * admin-auth-token, or the session cookie a browser got from `POST /admin/api/session` (then a `POST`
 * also carries `x-pikit-admin: 1`). An error is an `ApiError` with its status.
 *
 * **The dashboard is a channel of its own.** It reads every conversation, and writes only into its own
 * (keys `dashboard:<uuid>`, `POST /admin/api/conversations`) and as follow-ups to another channel's
 * conversation, whose answers it keeps: the request ids of its messages start with `dashboard:`, and a
 * run only they started is never delivered to the conversation's chat.
 *
 * | Route | Answer |
 * |---|---|
 * | `GET /admin/api/app` | `ApiApp`: the composition (`APP_DESCRIPTION`, no secrets) |
 * | `GET /admin/api/agents` | `ApiAgents`: the App's agents (the code's, then the live ones), their model and tools, and which is the steward |
 * | `POST /admin/api/session` | the credential once → `200 ApiSession` and a session cookie (a browser's) |
 * | `DELETE /admin/api/session` | `204`: the session cookie cleared |
 * | `GET /admin/api/conversations?limit&cursor&archived` | `ApiPage<ApiConversation>`, the most recently active first: those listed, or with `archived=1` those archived |
 * | `POST /admin/api/conversations` | `ApiStartRequest` → `201 ApiStartResponse`: a conversation of the dashboard's own |
 * | `GET /admin/api/conversations/:id` | `ApiConversation` |
 * | `GET /admin/api/conversations/:id/transcript?limit&cursor` | `ApiPage<ApiTranscriptEntry>`, newest first |
 * | `GET /admin/api/conversations/:id/events` | server-sent events, one `ApiEvent` per `data:` line; `snapshot` first |
 * | `POST /admin/api/conversations/:id/messages` | `ApiSendRequest` → `202 ApiSendResponse` |
 * | `POST /admin/api/conversations/:id/abort` | `200 ApiAbortResponse` |
 * | `POST /admin/api/conversations/:id/reset` | `200 ApiResetResponse` |
 * | `POST /admin/api/conversations/:id/archive`, `…/unarchive`, `…/delete` | `200 ApiHideResponse`: the list only (a deleted one is never listed again, nothing of the runtime's is deleted; new activity lists either again) |
 * | `GET /admin/api/commands` | `ApiCommands`: the slash commands the App registered (`agent.command`) |
 * | `POST /admin/api/conversations/:id/commands/:name` | `ApiCommandRequest` → `200 ApiCommandResponse`: the command run in the conversation |
 * | `GET /admin/api/delivery/pending?limit&cursor` | `ApiPage<ApiPendingPiece>`, oldest stored first (with `outbound.queue`) |
 * | `GET /admin/api/delivery/receipts?after&limit` | `ApiReceiptsPage`, in the order they settled (with `outbound.queue`) |
 */

/** The keys of the dashboard's own conversations: `dashboard:<uuid>`. No other channel makes one. */
export const DASHBOARD_KEY_PREFIX = "dashboard:";

/** Whether `key` is one of the dashboard's own conversations. */
export const isDashboardKey = (key: string | undefined): boolean => key?.startsWith(DASHBOARD_KEY_PREFIX) === true;

/** How every message from the dashboard starts, as the agent reads it (`operatorPrompt`). */
export const OPERATOR_NOTE = "[From the operator, in the pikit dashboard";

/** The tool an agent searches the web with (`tool-websearch-brave` provides it under this name). */
export const WEB_SEARCH_TOOL = "websearch";

/**
 * `text` as the agent reads it, sent from the dashboard to the conversation `key`: a first line says it
 * comes from the operator, and, in another channel's conversation, that its user sees neither it nor
 * the answer; with `webSearch`, that the agent is to search the web for it (`WEB_SEARCH_TOOL`).
 */
export function operatorPrompt(key: string, text: string, options: { webSearch?: boolean } = {}): string {
  const asks = [
    ...(isDashboardKey(key) ? [] : ["the user of this conversation does not see this message or your answer to it"]),
    ...(options.webSearch === true ? [`search the web for it with the ${WEB_SEARCH_TOOL} tool before you answer`] : []),
  ];
  const note = asks.length === 0 ? `${OPERATOR_NOTE}.]` : `${OPERATOR_NOTE}: ${asks.join("; ")}.]`;
  return `${note}\n${text}`;
}

/** The longest title a conversation has (`cleanTitle`). */
export const TITLE_MAX = 60;

/** Labels a model may put before a title ("Title: …"), in a few languages: taken off. */
const TITLE_LABEL = /^(?:title|name|subject|topic|t\u00edtulo|titulo|titre|titel|titolo|nombre|nom)(?:\s*:\s*|\s+[-\u2013\u2014]\s+)/i;
/** Quotes and markdown a title is wrapped in. */
const TITLE_WRAP = /^[\s"'`*_#>\u2018\u2019\u201c\u201d\u00ab\u00bb\u300c\u300d-]+|[\s"'`*_\u2018\u2019\u201c\u201d\u00ab\u00bb\u300c\u300d]+$/g;

/**
 * A presentable title from `text` (a model's answer, or what an operator wrote with `/name`), or
 * `undefined` when nothing is left: its first line that has words, without a label ("Title:"),
 * quotes or markdown around it, its spaces collapsed, no `.`, `,`, `;` or `:` at its end, its first
 * letter a capital, at most `TITLE_MAX` characters (cut at a word, with an ellipsis).
 */
export function cleanTitle(text: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .map((each) => each.replace(TITLE_WRAP, "").replace(TITLE_LABEL, "").replace(TITLE_WRAP, "").replace(/\s+/g, " ").trim())
    .find((each) => /[\p{L}\p{N}]/u.test(each));
  if (line === undefined) return undefined;
  let title = line.replace(/[.,;:\s]+$/u, "");
  if (title.length > TITLE_MAX) {
    const cut = title.slice(0, TITLE_MAX - 1);
    const space = cut.lastIndexOf(" ");
    title = `${(space >= TITLE_MAX / 3 ? cut.slice(0, space) : cut).replace(/[.,;:\s]+$/u, "")}\u2026`;
  }
  return title === "" ? undefined : title.charAt(0).toLocaleUpperCase() + title.slice(1);
}

/** The images an operator may attach to a message: these types, `MAX_IMAGES` of `MAX_IMAGE_BYTES` at most. */
export const IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/**
 * On Cloudflare (`ApiApp.target` `durable`), the images of one message in all: the message is stored in
 * one Durable Object row, which holds at most 2 MB, and the images grow by a third in base64.
 */
export const MAX_DURABLE_IMAGE_BYTES = 1024 * 1024;

/** The bytes base64 `data` decodes to. */
export const base64Bytes = (data: string): number => Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * What is wrong with a message's `attachments`, or `undefined`: too many, not an image of
 * `IMAGE_TYPES`, or not base64 (`400`); one larger than `MAX_IMAGE_BYTES`, or on `target` `durable`
 * more than `MAX_DURABLE_IMAGE_BYTES` in all (`413`). The dashboard checks with it before sending, and
 * the API again.
 */
export function attachmentsProblem(attachments: readonly ApiAttachment[], target?: string): { status: 400 | 413; message: string } | undefined {
  if (attachments.length > MAX_IMAGES) return { status: 400, message: `at most ${MAX_IMAGES} images a message` };
  let total = 0;
  for (const [i, attachment] of attachments.entries()) {
    if (attachment.kind !== "image" || !IMAGE_TYPES.includes(attachment.mimeType)) return { status: 400, message: `attachment ${i + 1}: an image is ${IMAGE_TYPES.join(", ")}` };
    if (attachment.data.length % 4 !== 0 || !BASE64.test(attachment.data)) return { status: 400, message: `attachment ${i + 1}: its data is not base64` };
    const bytes = base64Bytes(attachment.data);
    if (bytes > MAX_IMAGE_BYTES) return { status: 413, message: `attachment ${i + 1}: an image is at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
    total += bytes;
  }
  if (target === "durable" && total > MAX_DURABLE_IMAGE_BYTES) {
    return { status: 413, message: `on Cloudflare the images of a message are at most ${MAX_DURABLE_IMAGE_BYTES / 1024 / 1024} MB in all (a Durable Object row holds 2 MB)` };
  }
  return undefined;
}

/** What a conversation cost: every model call and tool summed (pi-ai's `Usage`). */
export interface ApiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

/** One conversation of the runtime. */
export interface ApiConversation {
  /**
   * What `:id` is in the routes, opaque (encode it in a path): the runtime's id on a server,
   * `<key>~<the object's id>` on Cloudflare, where each conversation's object numbers its own.
   */
  conversationId: string;
  /**
   * Its conversation key (`telegram:12345`) and agent, once a message reached it or a reset pointed
   * its key to it (a reset's new conversation is its key's current one, talked to at once).
   */
  key?: string;
  agent?: string;
  /** Whether a run is going now. */
  busy: boolean;
  /** Epoch ms of its newest message. */
  lastActivity?: number;
  usage: ApiUsage;
  /**
   * Whether its key points to it now. `false` for a conversation a reset left behind: it can be read,
   * not talked to. Absent when it has no key: no message reached it and no reset pointed a key to it.
   */
  current?: boolean;
  /**
   * Its title (`cleanTitle`): the one a model gave it after its first run, or the operator's (`/name`).
   * Until it has one, its first message (cleaned the same way) once a model was asked to title it. A
   * reset's new conversation has its own. Absent until then.
   */
  title?: string;
}

/** One page, and the cursor of the next (absent on the last page). */
export interface ApiPage<T> {
  items: T[];
  next?: string;
}

/** One entry of a conversation's history: its messages in the runtime's JSON (pi-ai's `Message`). */
export interface ApiTranscriptEntry {
  id: string;
  /** `message`, `pi.reset`, …: the runtime's words. */
  kind: string;
  messages: unknown[];
}

/**
 * One live event of a conversation, in the runtime's JSON. The first is a `snapshot` of what the
 * conversation is now; a client that fell behind gets a new `snapshot`, so a view is rebuilt from the
 * last `snapshot` and the events after it, never from a count of events.
 */
export interface ApiEvent {
  type: string;
  [field: string]: unknown;
}

/** One of the App's agents (`agent.definition`, or a live one of `agent.directory`), as it is defined. */
export interface ApiAgent {
  name: string;
  /** An agent that is data (`agent.directory`: made in the dashboard, agents-live), not the code's. */
  live?: true;
  /** A live agent's one line: what it is for. */
  description?: string;
  /** `provider/modelId`. */
  model: string;
  /**
   * The names of the tools it is defined with (its `tools`; a tool object by its name). Not the tools
   * its extensions bring, nor those a `prepare` gives for a state.
   */
  tools: string[];
  /** Whether it is the project's steward (`steward: true` in its `defineAgent`, SPEC §6): at most one is. */
  steward: boolean;
}

export interface ApiAgents {
  /** By name: the code's, then the live ones. */
  items: ApiAgent[];
}

/** An image attached to a message: the model reads it with the text, and the transcript keeps it. */
export interface ApiImageAttachment {
  kind: "image";
  /** One of `IMAGE_TYPES`. */
  mimeType: string;
  /** Its bytes, base64 (standard, padded), without a `data:` prefix: at most `MAX_IMAGE_BYTES`. */
  data: string;
}

export type ApiAttachment = ApiImageAttachment;

/**
 * A message from an operator to a conversation: a follow-up (with a run going it waits for it), whose
 * answer stays in the dashboard. The agent reads it after `operatorPrompt`'s first line.
 */
export interface ApiSendRequest {
  /** May be empty when it has attachments. */
  text: string;
  /** Images, at most `MAX_IMAGES` (`attachmentsProblem`: `400`, `413`). */
  attachments?: ApiAttachment[];
  /**
   * The agent is told, in the message's first line, to search the web for it. Only for an agent with
   * the tool `WEB_SEARCH_TOOL`: another is `400`.
   */
  webSearch?: boolean;
  /**
   * Its identity: the same one sent again does not run again. `dashboard:` then 1 to 118 of
   * `A-Z a-z 0-9 . _ ~ : -`. Absent, admin-api makes one.
   */
  requestId?: string;
}

export interface ApiSendResponse {
  requestId: string;
  /** `started`: a run started; `queued`: it waits for the run going; `duplicate`: already there. */
  admission: "started" | "queued" | "duplicate";
}

/** A new conversation of the dashboard's own, with its first message. */
export interface ApiStartRequest {
  /** One of the App's agents (`GET /admin/api/agents`): the code's, or a live one. */
  agent: string;
  /** As `ApiSendRequest`'s. */
  text: string;
  attachments?: ApiAttachment[];
  webSearch?: boolean;
  /** As `ApiSendRequest.requestId`. */
  requestId?: string;
}

export interface ApiStartResponse extends ApiSendResponse {
  conversationId: string;
  /** `dashboard:<uuid>`. */
  key: string;
}

/** A slash command the App registered (`agent.command`), as a menu lists it. */
export interface ApiCommand {
  /** Without its slash: `new`, `name`, `compact`. */
  name: string;
  /** One line. */
  description: string;
  /** What its arguments are: `<title>`. Absent: it takes none. */
  argumentHint?: string;
}

export interface ApiCommands {
  /** By name. Empty when the App registered none. */
  items: ApiCommand[];
}

/** A command run in a conversation: what follows its name. */
export interface ApiCommandRequest {
  /** The text after `/name `, at most `MAX_COMMAND_ARGS` characters; absent or empty: none. */
  args?: string;
}

/** The longest arguments a command takes, in characters. */
export const MAX_COMMAND_ARGS = 4_000;

/**
 * What a command answered: a note for the operator (the dashboard shows it in the conversation,
 * quietly; no channel gets it, and it is in the transcript only if the command wrote there), or none.
 */
export interface ApiCommandResponse {
  text?: string;
}

/** A browser's session, opened. */
export interface ApiSession {
  /** The operator's id, as `admin.auth` names it. */
  operator: string;
}

export interface ApiAbortResponse {
  conversationId: string;
}

/** What archive, unarchive and delete did: the conversation, put away or back in the list. */
export interface ApiHideResponse {
  conversationId: string;
}

export interface ApiResetResponse {
  key: string;
  /** The conversation the key pointed to, kept and readable. */
  previousConversationId: string;
  /** The new, empty conversation the key points to now. */
  conversationId: string;
}

/** A piece of an answer not delivered yet (`outbound.queue`'s `pending`). Never its text. */
export interface ApiPendingPiece {
  idempotencyKey: string;
  /** Which of the answer's pieces: 0 is the first. */
  index: number;
  channel: string;
  conversationKey: string;
  /** `queued`: never tried; `sending`: in flight; `retrying`: tried, waiting to go again. */
  state: "queued" | "sending" | "retrying";
  attempts: number;
  /** Epoch ms before which it is not tried again; absent while sending. */
  nextAttemptAt?: number;
  /** Why its last try did not deliver it, short. */
  lastError?: string;
  /** Its next send may repeat one that reached the platform. */
  possibleDuplicate: boolean;
  storedAt: number;
}

/** A piece that settled (`outbound.queue`'s `receipts`), with the cursor to read after it. */
export interface ApiReceipt {
  cursor: string;
  idempotencyKey: string;
  index: number;
  channel: string;
  conversationKey: string;
  attempts: number;
  outcome: { kind: "delivered"; platformMessageId: string; possibleDuplicate: boolean } | { kind: "abandoned"; reason: string };
  /** Epoch ms when it settled. */
  at: number;
}

/** Receipts after a cursor: `next` is the last one's, to read on from; `gap`: some were pruned before this read. */
export interface ApiReceiptsPage {
  items: ApiReceipt[];
  gap: boolean;
  next?: string;
}

/**
 * The composition (`AppDescription`, K13): JSON, no secrets. A config value that looks like one (under a
 * key such as `token`, `secret`, `password`, `apiKey`, or shaped like a credential) is `[redacted]`.
 */
export interface ApiApp {
  version: number;
  target: string;
  components: { name: string; version?: string; provides: string[]; requires: string[]; optional: string[] }[];
  capabilities: Record<string, { providers: string[]; selected?: string; keys?: Record<string, string> }>;
  pipelines: Record<string, unknown[]>;
  config: Record<string, unknown>;
}

export interface ApiError {
  /**
   * `unauthorized`, `not_found`, `not_installed`, `invalid_request`, `invalid_cursor`, `no_agent`,
   * `not_current`, `unknown_agent`, `too_large` (413: an image, or a body, larger than the API takes),
   * `unknown_command` (404: no command of that name), `command_failed` (422: the command could not do
   * it, its message says why);
   * `unavailable` (503) when, on Cloudflare, a conversation's object did not answer.
   */
  error: string;
  message?: string;
}
