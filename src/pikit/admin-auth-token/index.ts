/**
 * admin-auth-token: who is an operator, by a bearer token (`admin.auth`, @pikit/contracts' admin.ts).
 * An admin API route (admin-api's, a component's own) asks `verify(request)`; a request that carries
 * `Authorization: Bearer <PIKIT_ADMIN_TOKEN>`, or the session cookie a browser got for it, is the
 * operator `operator`, any other is not.
 *
 * - **The token is a secret**, read through `secrets` at start: an environment variable on a server
 *   (secrets-env), a Worker secret on Cloudflare (secrets-cloudflare). Without it, or shorter than 32
 *   characters, the app does not start: a dashboard nobody can open, or anybody can, is a broken
 *   deployment. `pikit configure --generate PIKIT_ADMIN_TOKEN` writes one.
 * - **Compared in constant time**, as SHA-256 digests, so a wrong token's timing says nothing of the
 *   right one. Only the digest and a key derived from the token are kept in memory; the token is in no
 *   log line, error, operator or cookie.
 * - **Browser sessions** (`sessions`): the dashboard posts the token once (admin-api's
 *   `POST /admin/api/session`) and gets a cookie, `pikit_admin_session`: the time it expires (12 h on)
 *   and an HMAC-SHA256 of it with a key derived from the token (HKDF), `HttpOnly`, `SameSite=Strict`,
 *   `Path=/admin/api`, `Secure` when the request came over https. A request whose method changes
 *   something must also carry `x-pikit-admin` (`ADMIN_CLIENT_HEADER`) for the cookie to count: the
 *   CSRF defence, with `SameSite=Strict`. Changing the token ends every session. Scripts keep sending
 *   the bearer token, which needs no header.
 * - **Headers only.** The body is the route's.
 *
 * Replace it to sign operators in another way (an SSO proxy's header, Cloudflare Access): a
 * component that provides `admin.auth` and passes `createAdminAuthConformance`.
 *
 * Targets: `server` and `durable`: it uses only `secrets` and Web Crypto.
 */

import { type AppContext, defineComponent } from "@pikit/core";
import { ADMIN_CLIENT_HEADER, type AdminAuth, type AdminSessions, type Operator } from "@pikit/contracts";
import Type from "typebox";

/** The secret holding the operators' token, by default. */
export const TOKEN_SECRET = "PIKIT_ADMIN_TOKEN";
/** Shorter tokens are refused at start: an operator's token guards every conversation. */
export const MIN_TOKEN_LENGTH = 32;
/** The browser session's cookie. */
export const SESSION_COOKIE = "pikit_admin_session";
/** How long a browser session lasts. */
export const SESSION_MS = 12 * 60 * 60 * 1000;
/** Where the browser sends the cookie: the admin API only, never the dashboard's files. */
const COOKIE_PATH = "/admin/api";
/** What the session key is derived for (HKDF's `info`): another use of the token gets another key. */
const SESSION_INFO = "pikit admin-auth-token session v1";
/** Methods that change nothing: the cookie counts without the client's header. */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

const Config = Type.Object({
  /** The name of the secret holding the token, not the token: config is never secret. */
  tokenSecret: Type.String({ minLength: 1, default: TOKEN_SECRET }),
});

/** The operator a valid token is. One token, one operator. */
const OPERATOR: Operator = Object.freeze({ id: "operator" });

export default defineComponent({
  name: "admin-auth-token",
  config: Config,
  setup(pikit, config) {
    const secrets = pikit.use("secrets");
    /** The token's digest and the session key, from start to stop. */
    let expected: Uint8Array | undefined;
    let sessionKey: CryptoKey | undefined;

    const byToken = async (request: Request): Promise<Operator | undefined> => {
      const presented = /^Bearer[ ]+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      if (presented === undefined || expected === undefined) return undefined;
      return (await matches(presented, expected)) ? OPERATOR : undefined;
    };

    const bySession = async (request: Request, ctx: AppContext): Promise<Operator | undefined> => {
      const value = cookieOf(request, SESSION_COOKIE);
      if (value === undefined || sessionKey === undefined) return undefined;
      if (!SAFE.has(request.method.toUpperCase()) && request.headers.get(ADMIN_CLIENT_HEADER) === null) return undefined;
      const match = /^([0-9]{1,16})\.([A-Za-z0-9_-]{43})$/.exec(value);
      if (match === null) return undefined;
      const expires = Number(match[1]);
      if (!(expires > ctx.clock.now())) return undefined;
      const signature = fromBase64Url(match[2] as string);
      if (signature === undefined) return undefined;
      return (await crypto.subtle.verify("HMAC", sessionKey, signature, encode(signed(OPERATOR.id, expires)))) ? OPERATOR : undefined;
    };

    const attributes = (request: Request, maxAge: number): string =>
      `Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${isHttps(request) ? "; Secure" : ""}`;

    const sessions: AdminSessions = {
      async open(request, ctx) {
        const operator = await byToken(request);
        if (operator === undefined || sessionKey === undefined) return undefined;
        const expires = ctx.clock.now() + SESSION_MS;
        const signature = new Uint8Array(await crypto.subtle.sign("HMAC", sessionKey, encode(signed(operator.id, expires))));
        return { operator, cookie: `${SESSION_COOKIE}=${expires}.${toBase64Url(signature)}; ${attributes(request, SESSION_MS / 1000)}` };
      },
      close: (request) => `${SESSION_COOKIE}=; ${attributes(request, 0)}`,
    };

    const auth: AdminAuth = {
      async verify(request, ctx) {
        // A request with a bearer token is decided by it alone.
        if (request.headers.has("authorization")) return byToken(request);
        return bySession(request, ctx);
      },
      sessions,
    };
    pikit.provide("admin.auth", auth);

    return {
      async start() {
        const token = await secrets.get().get(config.tokenSecret);
        if (token === undefined) throw new Error(`admin-auth-token: the secret ${config.tokenSecret} is not set`);
        if (token.length < MIN_TOKEN_LENGTH) throw new Error(`admin-auth-token: the secret ${config.tokenSecret} is shorter than ${MIN_TOKEN_LENGTH} characters`);
        expected = await digest(token);
        sessionKey = await deriveSessionKey(token);
      },
      stop() {
        expected = undefined;
        sessionKey = undefined;
      },
    };
  },
});

// Copied: Workers' types say `encode` may answer a view of a shared buffer, which `crypto.subtle` does not take.
const encode = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(text));

/** What a session's signature covers. */
const signed = (operator: string, expires: number): string => `${operator}\n${expires}`;

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encode(text)));
}

/** Whether `presented` is the token whose digest is `expected`, in time independent of both. */
async function matches(presented: string, expected: Uint8Array): Promise<boolean> {
  const actual = await digest(presented);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return difference === 0;
}

/** The HMAC key of the sessions, derived from the token (HKDF-SHA256): it cannot be read back. */
async function deriveSessionKey(token: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encode(token), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encode(SESSION_INFO) },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** The value of the cookie `name` in `request`'s `Cookie` header. */
function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** Whether the browser reached the app over https (directly, or through a proxy that says so). */
function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}
