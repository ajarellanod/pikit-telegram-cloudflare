/**
 * The admin API (admin-api, `/admin/api/*`), from the browser. Its JSON is typed in `admin-api.ts`, an
 * identical copy of admin-api's own `api.ts` (`src/pikit/admin-api/api.ts`): change both together.
 *
 * **Signing in** (`signIn`) posts the operator's token once, to `POST /admin/api/session`, which
 * answers with a session cookie (HttpOnly, SameSite=Strict, sent to `/admin/api/` only, expiring):
 * the token is kept nowhere, and no script can read the session. `signOut` clears it. Every call
 * carries the header `x-pikit-admin: 1`, which a page of another site cannot send, so the cookie
 * alone changes nothing. An `admin.auth` without browser sessions (`404 not_installed`): the token is
 * kept in this page's memory only, and asked again after a reload.
 *
 * A browser's `EventSource` cannot send the header, so live events are read with `fetch`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePolling } from "./activity.ts";
import type { ApiError, ApiEvent, ApiSession } from "./admin-api.ts";

export type * from "./admin-api.ts";

const API = "/admin/api";
/** `ADMIN_CLIENT_HEADER` (@pikit/contracts): what makes a call the dashboard's own. */
const CLIENT_HEADER = "x-pikit-admin";

/** The token, when the API has no browser sessions: this page's memory only. */
let memoryToken: string | undefined;

/** An answer that is not a success: its status and the API's error. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.message ?? body.error);
    this.status = status;
    this.body = body;
  }
}

/** Listeners told when the API refuses the token (401): the app asks for it again. */
const unauthorized = new Set<() => void>();
export function onUnauthorized(listener: () => void): () => void {
  unauthorized.add(listener);
  return () => unauthorized.delete(listener);
}

function headers(extra?: HeadersInit): Headers {
  const all = new Headers(extra);
  all.set(CLIENT_HEADER, "1");
  if (memoryToken !== undefined) all.set("authorization", `Bearer ${memoryToken}`);
  return all;
}

/**
 * Signs in with the operator's `token` (PIKIT_ADMIN_TOKEN with admin-auth-token): a session cookie,
 * or, without browser sessions, the token in memory. Answers the operator's id when the API names it.
 * Throws an `ApiFailure` (`401`: not the token).
 */
export async function signIn(token: string): Promise<string | undefined> {
  const response = await fetch(`${API}/session`, { method: "POST", headers: { [CLIENT_HEADER]: "1", authorization: `Bearer ${token}` } });
  if (response.ok) {
    memoryToken = undefined;
    const session = (await response.json().catch(() => undefined)) as ApiSession | undefined;
    return typeof session?.operator === "string" ? session.operator : undefined;
  }
  const body = (await response.json().catch(() => ({ error: `http_${response.status}` }))) as ApiError;
  if (response.status !== 404 || body.error !== "not_installed") throw new ApiFailure(response.status, body);
  // No sessions: the token goes with every call, from memory, if the API takes it.
  memoryToken = token;
  try {
    await api("/app");
  } catch (error) {
    memoryToken = undefined;
    throw error;
  }
  return undefined;
}

/** Signs out: the session cookie cleared (and the token forgotten). */
export async function signOut(): Promise<void> {
  memoryToken = undefined;
  await fetch(`${API}/session`, { method: "DELETE", headers: { [CLIENT_HEADER]: "1" } }).catch(() => undefined);
}

async function failure(response: Response): Promise<ApiFailure> {
  if (response.status === 401) for (const listener of unauthorized) listener();
  const body = (await response.json().catch(() => ({ error: `http_${response.status}` }))) as ApiError;
  return new ApiFailure(response.status, body);
}

/** `GET` (or `init`'s method) of `path` under /admin/api, as JSON. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: headers(init.headers) });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/** `POST` of `body` (JSON) to `path` under /admin/api. */
export function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

/**
 * Follows `path`'s server-sent events until `signal` aborts or the stream ends: each `data:` line is
 * one event. Resolves when the stream ends; rejects when it cannot start.
 */
export async function follow(path: string, onEvent: (event: ApiEvent) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${API}${path}`, { headers: headers({ accept: "text/event-stream" }), signal });
  if (!response.ok || response.body === null) throw await failure(response);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (data !== "" && !frame.startsWith("event: error")) onEvent(JSON.parse(data) as ApiEvent);
        end = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export interface Loaded<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload(): void;
}

/** `GET path`, again on `reload()`, and every `everyMs` when given while the dashboard is active. `null` loads nothing. */
export function useApi<T>(path: string | null, everyMs?: number): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(path !== null);
  const [round, setRound] = useState(0);
  const current = useRef(path);
  current.current = path;

  useEffect(() => {
    if (path === null) return;
    let live = true;
    setLoading(true);
    api<T>(path)
      .then((value) => live && current.current === path && (setData(value), setError(undefined)))
      .catch((thrown: unknown) => live && setError(thrown instanceof Error ? thrown : new Error(String(thrown))))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, round]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  // Only while the operator is here (`activity.ts`).
  usePolling(reload, path === null ? undefined : everyMs);
  return { data, error, loading, reload };
}
