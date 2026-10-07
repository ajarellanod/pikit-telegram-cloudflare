/**
 * admin-api's routes (`api.ts` says what each answers), written once over a backend (`backend.ts`):
 * a server's contracts, or on Cloudflare the Worker's calls to the objects. Both halves of the
 * component register them (`index.ts`, `worker.ts`).
 *
 * - Every `/admin/api/*` answer asks `admin.auth` first: no operator, `401`, nothing read. But the
 *   session's: `POST /admin/api/session` gives a browser a session cookie for the credential it posts
 *   once (`admin.auth`'s `sessions`), `DELETE` clears it. Both need the client's header
 *   (`ADMIN_CLIENT_HEADER`), so a page of another site cannot sign a browser in or out.
 * - What an operator writes (`backend.ts`): a message is a follow-up whose request id starts with
 *   `dashboard:`, and a new conversation is the dashboard's own, `dashboard:<uuid>`.
 * - A backend's refusal (`ActorCallError`) is its status: `not_found`, `unknown_command` `404`;
 *   `no_agent`, `not_current` `409`; `invalid_cursor`, `invalid_request`, `unknown_agent` `400`;
 *   `too_large` `413`; `command_failed` `422`. Any other code (an object that could not be reached, a
 *   call that failed) is `503 unavailable`, logged.
 * - A slash command (`agent.command`) runs in a conversation as the other actions do (an operator, the
 *   key's current conversation), logged with its name, never its arguments.
 * - A message's images are checked here (`attachmentsProblem`: their number and types `400`, their size
 *   `413`), and a body larger than the most a message can be is `413` before it is read.
 * - Each action is logged with the operator's id and the conversation's key, never the message's text.
 * - Live events are server-sent events over a plain streaming response, a comment every
 *   `heartbeatMs`; the stream ends when the client goes away, the backend's events end, or the server
 *   stops. A browser's `EventSource` cannot send the token: the dashboard reads it with `fetch`.
 */

import type { AppContext, Handle, Pikit } from "@pikit/core";
import {
  ADMIN_CLIENT_HEADER,
  ActorCallError,
  type AdminAuth,
  DASHBOARD_REQUEST_PREFIX,
  type HttpRoute,
  type Operator,
  type OutboundQueue,
  type PageRequest,
} from "@pikit/contracts";
import Type, { type Static } from "typebox";
import Value from "typebox/value";
import {
  type ApiAbortResponse,
  type ApiAgents,
  type ApiApp,
  type ApiCommandResponse,
  type ApiCommands,
  type ApiConversation,
  type ApiError,
  type ApiEvent,
  type ApiPage,
  type ApiPendingPiece,
  type ApiReceipt,
  type ApiReceiptsPage,
  type ApiHideResponse,
  type ApiResetResponse,
  type ApiSendResponse,
  type ApiSession,
  type ApiStartResponse,
  type ApiTranscriptEntry,
  attachmentsProblem,
  DASHBOARD_KEY_PREFIX,
  MAX_COMMAND_ARGS,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
} from "./api.ts";
import { type Assets, BASE } from "./assets.ts";
import type { AdminBackend } from "./backend.ts";

/** A request id: what `ApiSendRequest.requestId` may be, the dashboard's (`dashboard:…`). */
const REQUEST_ID = `^${DASHBOARD_REQUEST_PREFIX}[A-Za-z0-9._~:-]{1,118}$`;
/** The largest page a client may ask for. */
const MAX_LIMIT = 500;
/** The longest message an operator may send, in characters. */
const MAX_TEXT = 32_000;

/** The largest body a message can be: its images in base64, its text, and room for the rest. */
const MAX_BODY = MAX_IMAGES * Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + MAX_TEXT * 6 + 64 * 1024;

/** An attachment's shape; what it holds is `attachmentsProblem`'s to check. */
const Attachment = Type.Object({ kind: Type.Literal("image"), mimeType: Type.String({ maxLength: 100 }), data: Type.String() }, { additionalProperties: false });
const MessageFields = {
  text: Type.String({ maxLength: MAX_TEXT }),
  attachments: Type.Optional(Type.Array(Attachment)),
  webSearch: Type.Optional(Type.Boolean()),
  requestId: Type.Optional(Type.String({ pattern: REQUEST_ID })),
};
const SendBody = Type.Object(MessageFields, { additionalProperties: false });
const StartBody = Type.Object({ agent: Type.String({ minLength: 1, maxLength: 200 }), ...MessageFields }, { additionalProperties: false });
const CommandBody = Type.Object({ args: Type.Optional(Type.String({ maxLength: MAX_COMMAND_ARGS })) }, { additionalProperties: false });

/** The status of each refusal a backend throws; any other is `503`. */
const STATUS: Record<string, number> = {
  not_found: 404,
  unknown_command: 404,
  no_agent: 409,
  not_current: 409,
  invalid_cursor: 400,
  invalid_request: 400,
  unknown_agent: 400,
  too_large: 413,
  command_failed: 422,
};

const json = <T>(status: number, body: T): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const failure = (status: number, error: string, message?: string): Response =>
  json<ApiError>(status, { error, ...(message !== undefined && message !== "" && { message }) });
const UNAUTHORIZED = (): Response =>
  Response.json({ error: "unauthorized" } satisfies ApiError, { status: 401, headers: { "www-authenticate": 'Bearer realm="pikit"', "cache-control": "no-store" } });

/** The `:id` of `/admin/api/conversations/:id/…`, decoded; `""` when malformed. */
function conversationIdOf(request: Request): string {
  const raw = new URL(request.url).pathname.split("/")[4] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

/** The `:name` of `/admin/api/conversations/:id/commands/:name`, decoded; `""` when malformed. */
function commandNameOf(request: Request): string {
  const raw = new URL(request.url).pathname.split("/")[6] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

/** `?limit&cursor`, or what is wrong with them. */
function pageOf(request: Request): PageRequest | { problem: string } {
  const params = new URL(request.url).searchParams;
  const page: PageRequest = {};
  const limit = params.get("limit");
  if (limit !== null) {
    const value = Number(limit);
    if (!/^[0-9]+$/.test(limit) || value < 1 || value > MAX_LIMIT) return { problem: `limit is an integer from 1 to ${MAX_LIMIT}` };
    page.limit = value;
  }
  const cursor = params.get("cursor");
  if (cursor !== null) page.cursor = cursor;
  return page;
}

/**
 * `request`'s message, checked against `schema`: something written or attached, images the API takes.
 * Or what is wrong with it, and its status.
 */
async function readMessage<S extends typeof SendBody | typeof StartBody>(request: Request, schema: S): Promise<{ body: Static<S> } | { status: number; error: string; problem: string }> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return { status: 413, error: "too_large", problem: `a message is at most ${Math.round(MAX_BODY / 1024 / 1024)} MB` };
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { status: 400, error: "invalid_request", problem: "the body is not JSON" };
  }
  if (!Value.Check(schema, parsed)) {
    const [first] = Value.Errors(schema, parsed);
    return { status: 400, error: "invalid_request", problem: `${first?.instancePath || "the body"}: ${first?.message ?? "is invalid"}` };
  }
  const body = parsed as Static<S>;
  const attachments = body.attachments ?? [];
  if (body.text === "" && attachments.length === 0) return { status: 400, error: "invalid_request", problem: "/text: write something, or attach an image" };
  const wrong = attachmentsProblem(attachments);
  if (wrong !== undefined) return { status: wrong.status, error: wrong.status === 413 ? "too_large" : "invalid_request", problem: `/attachments: ${wrong.message}` };
  return { body };
}

/** What the log says of a message besides its text: how many images, whether it asks for a web search. */
const facts = (message: { attachments?: unknown[]; webSearch?: boolean }) => ({
  ...(message.attachments !== undefined && message.attachments.length > 0 && { images: message.attachments.length }),
  ...(message.webSearch === true && { webSearch: true }),
});

/** The request id of an operator's message: the client's, or a new one. */
const requestIdOf = (given: string | undefined): string => given ?? `${DASHBOARD_REQUEST_PREFIX}${crypto.randomUUID()}`;

/**
 * `events` as server-sent events, a comment every `heartbeatMs`; cancelling the response stops them.
 * Events that fail end the stream with an `error` event (logged, never its details).
 */
function eventStream(events: AsyncIterable<ApiEvent>, heartbeatMs: number, ctx: AppContext): Response {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const finish = (): void => {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          finish();
        }
      }, heartbeatMs);
    },
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done === true) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
      } catch (error) {
        finish();
        ctx.logger.warn("admin-api: a conversation's live events stopped", { error: error instanceof Error ? error.message : String(error) });
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "watch_failed" } satisfies ApiError)}\n\n`));
        controller.close();
      }
    },
    async cancel() {
      finish();
      await iterator.return?.();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

export interface RouteOptions {
  auth: Handle<AdminAuth>;
  /** Read in a handler, never in setup. */
  backend(): AdminBackend;
  /** The outbound queue delivery is read from; `undefined` when none is installed here. */
  queue(): OutboundQueue | undefined;
  /** What `/admin/api/delivery/*` says without a queue. */
  noQueue: string;
  heartbeatMs: number;
  assets: Assets;
}

/** Registers every admin route of the App `pikit` sets up, and the dashboard's files. */
export function provideRoutes(pikit: Pikit, options: RouteOptions): void {
  /** An API route: answers only an operator; a backend's refusal is its status. */
  const api = (key: string, handler: (request: Request, ctx: AppContext, operator: Operator) => Promise<Response>): void => {
    const route: HttpRoute = async (request, ctx) => {
      const operator = await options.auth.get().verify(request, ctx);
      if (operator === undefined) return UNAUTHORIZED();
      try {
        return await handler(request, ctx, operator);
      } catch (error) {
        if (!(error instanceof ActorCallError)) throw error;
        const status = STATUS[error.code];
        if (status !== undefined) return failure(status, error.code, error.message);
        ctx.logger.warn("admin-api: a conversation's object did not answer", { route: key, code: error.code, error: error.message });
        return failure(503, "unavailable", error.message);
      }
    };
    pikit.provideKeyed("http.route", key, route);
  };
  const backend = () => options.backend();

  // A browser's session: the credential once, then a cookie (`admin.auth`'s `sessions`).
  const session = (key: string, handler: HttpRoute): void => {
    pikit.provideKeyed("http.route", key, async (request, ctx) => {
      if (request.headers.get(ADMIN_CLIENT_HEADER) === null) return failure(400, "invalid_request", `send the header ${ADMIN_CLIENT_HEADER}: 1`);
      return handler(request, ctx);
    });
  };
  session("POST /admin/api/session", async (request, ctx) => {
    const sessions = options.auth.get().sessions;
    if (sessions === undefined) return failure(404, "not_installed", "this admin.auth has no browser sessions: send the credential with every call");
    const opened = await sessions.open(request, ctx);
    if (opened === undefined) return UNAUTHORIZED();
    ctx.logger.info("admin-api: an operator signed in", { operator: opened.operator.id });
    return Response.json({ operator: opened.operator.id } satisfies ApiSession, { headers: { "set-cookie": opened.cookie, "cache-control": "no-store" } });
  });
  session("DELETE /admin/api/session", async (request) => {
    const sessions = options.auth.get().sessions;
    return new Response(null, { status: 204, headers: { "cache-control": "no-store", ...(sessions !== undefined && { "set-cookie": sessions.close(request) }) } });
  });

  api("GET /admin/api/app", async (_request, ctx) => json<ApiApp>(200, await backend().app(ctx)));

  api("GET /admin/api/agents", async (_request, ctx) => json<ApiAgents>(200, await backend().agents(ctx)));

  api("GET /admin/api/conversations", async (request, ctx) => {
    const page = pageOf(request);
    if ("problem" in page) return failure(400, "invalid_request", page.problem);
    const archived = new URL(request.url).searchParams.get("archived");
    if (archived !== null && archived !== "1" && archived !== "0") return failure(400, "invalid_request", "archived is 1 or 0");
    return json<ApiPage<ApiConversation>>(200, await backend().conversations(page, ctx, archived === "1"));
  });

  api("GET /admin/api/conversations/:id", async (request, ctx) => json<ApiConversation>(200, await backend().conversation(conversationIdOf(request), ctx)));

  api("GET /admin/api/conversations/:id/transcript", async (request, ctx) => {
    const page = pageOf(request);
    if ("problem" in page) return failure(400, "invalid_request", page.problem);
    return json<ApiPage<ApiTranscriptEntry>>(200, await backend().transcript(conversationIdOf(request), page, ctx));
  });

  api("GET /admin/api/conversations/:id/events", async (request, ctx) => eventStream(await backend().live(conversationIdOf(request), ctx), options.heartbeatMs, ctx));

  api("POST /admin/api/conversations", async (request, ctx, operator) => {
    const read = await readMessage(request, StartBody);
    if ("problem" in read) return failure(read.status, read.error, read.problem);
    const { agent, requestId, ...message } = read.body;
    const key = `${DASHBOARD_KEY_PREFIX}${crypto.randomUUID()}`;
    const started = await backend().start({ key, agent, ...message, requestId: requestIdOf(requestId) }, ctx);
    ctx.logger.info("admin-api: an operator started a conversation", { operator: operator.id, conversation: key, agent, requestId: started.requestId, ...facts(message) });
    return json<ApiStartResponse>(201, started);
  });

  api("POST /admin/api/conversations/:id/messages", async (request, ctx, operator) => {
    const read = await readMessage(request, SendBody);
    if ("problem" in read) return failure(read.status, read.error, read.problem);
    const { requestId: given, ...message } = read.body;
    const requestId = requestIdOf(given);
    const sent = await backend().send(conversationIdOf(request), { ...message, requestId }, ctx);
    ctx.logger.info("admin-api: an operator sent a message", { operator: operator.id, conversation: sent.key, requestId, admission: sent.admission, ...facts(message) });
    return json<ApiSendResponse>(202, { requestId: sent.requestId, admission: sent.admission });
  });

  api("POST /admin/api/conversations/:id/abort", async (request, ctx, operator) => {
    const aborted = await backend().abort(conversationIdOf(request), ctx);
    ctx.logger.info("admin-api: an operator aborted a run", { operator: operator.id, conversation: aborted.key });
    return json<ApiAbortResponse>(200, { conversationId: aborted.conversationId });
  });

  api("POST /admin/api/conversations/:id/reset", async (request, ctx, operator) => {
    const reset = await backend().reset(conversationIdOf(request), ctx);
    ctx.logger.info("admin-api: an operator reset a conversation", { operator: operator.id, conversation: reset.key });
    return json<ApiResetResponse>(200, reset);
  });

  // The list only: what the operator puts away, and puts back. Any conversation, current or not.
  for (const [action, how] of [["archive", "archived"], ["unarchive", undefined], ["delete", "deleted"]] as const) {
    api(`POST /admin/api/conversations/:id/${action}`, async (request, ctx, operator) => {
      const id = conversationIdOf(request);
      await backend().hide(id, how, ctx);
      ctx.logger.info(`admin-api: an operator's ${action}`, { operator: operator.id, conversation: id });
      return json<ApiHideResponse>(200, { conversationId: id });
    });
  }

  api("GET /admin/api/commands", async (_request, ctx) => json<ApiCommands>(200, await backend().commands(ctx)));

  api("POST /admin/api/conversations/:id/commands/:name", async (request, ctx, operator) => {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_COMMAND_ARGS * 6 + 1024) return failure(413, "too_large", `a command's arguments are at most ${MAX_COMMAND_ARGS} characters`);
    const raw = await request.text();
    let parsed: unknown = {};
    try {
      if (raw.trim() !== "") parsed = JSON.parse(raw);
    } catch {
      return failure(400, "invalid_request", "the body is not JSON");
    }
    if (!Value.Check(CommandBody, parsed)) {
      const [first] = Value.Errors(CommandBody, parsed);
      return failure(400, "invalid_request", `${first?.instancePath || "the body"}: ${first?.message ?? "is invalid"}`);
    }
    const name = commandNameOf(request);
    const ran = await backend().command(conversationIdOf(request), name, (parsed as Static<typeof CommandBody>).args ?? "", ctx);
    ctx.logger.info("admin-api: an operator ran a command", { operator: operator.id, conversation: ran.key, command: name });
    return json<ApiCommandResponse>(200, ran.text === undefined ? {} : { text: ran.text });
  });

  /** A page read with the client's cursor: a queue refuses a cursor it did not give. */
  const paged = async <T>(cursor: string | undefined, read: () => Promise<T>): Promise<T | Response> => {
    if (cursor === undefined) return read();
    try {
      return await read();
    } catch {
      return failure(400, "invalid_cursor", "the cursor is not one this API gave");
    }
  };

  api("GET /admin/api/delivery/pending", async (request) => {
    const outbound = options.queue();
    if (outbound === undefined) return failure(404, "not_installed", options.noQueue);
    const page = pageOf(request);
    if ("problem" in page) return failure(400, "invalid_request", page.problem);
    const result = await paged(page.cursor, () => outbound.pending(page));
    if (result instanceof Response) return result;
    return json<ApiPage<ApiPendingPiece>>(200, result as ApiPage<ApiPendingPiece>);
  });

  api("GET /admin/api/delivery/receipts", async (request) => {
    const outbound = options.queue();
    if (outbound === undefined) return failure(404, "not_installed", options.noQueue);
    const after = new URL(request.url).searchParams.get("after") ?? undefined;
    const page = pageOf(request);
    if ("problem" in page) return failure(400, "invalid_request", page.problem);
    const read = await paged(after, () => outbound.receipts.read(after, page.limit ?? 100));
    if (read instanceof Response) return read;
    const items = read.items.map(({ cursor, fact }) => ({ cursor, ...fact }) as ApiReceipt);
    const next = items.at(-1)?.cursor ?? after;
    return json<ApiReceiptsPage>(200, { items, gap: read.gap, ...(next !== undefined && { next }) });
  });

  // Under /admin/api/ a path no route above serves is the API's 404, never the dashboard's page.
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) api(`${method} /admin/api/*`, async () => failure(404, "not_found"));

  pikit.provideKeyed("http.route", `GET ${BASE}/*`, (request) => options.assets.serve(new URL(request.url).pathname));
}
