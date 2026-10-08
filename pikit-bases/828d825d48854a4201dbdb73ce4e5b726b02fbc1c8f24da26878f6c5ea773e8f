# admin-auth-token

Who is an operator: a request that carries `Authorization: Bearer <PIKIT_ADMIN_TOKEN>`, or the
session cookie a browser got for that token. Every admin API route (admin-api's, a component's own)
asks it before answering; the dashboard's built files hold no data and are served without it, and the
page asks the operator for the token once, then keeps a session ("Browser sessions" below).

- **Provides:** `admin.auth` (`@pikit/contracts`' `admin.ts`).
- **Requires:** `secrets` (the token is read at start, never from config).
- **Targets:** `server` and `durable`: it uses only `secrets` and Web Crypto. On Cloudflare it goes in
  both Apps (`apps.worker: "default"`): the Worker's, where admin-api's routes ask it, and each
  conversation object's, where admin-api's object half is. Like on a server, without the token the
  App does not start: on Cloudflare that is the objects' App too.
- **Installs to:** `src/pikit/admin-auth-token/`.

## Configure

```sh
pikit configure --generate PIKIT_ADMIN_TOKEN   # a random token in .env (a Worker secret on Cloudflare)
```

Without the secret, or with one shorter than 32 characters, the app does not start: a dashboard
nobody can open, or anybody can, is a broken deployment. `tokenSecret` in config names another
secret.

## Use it from a route

```ts
const auth = pikit.use("admin.auth");
pikit.provideKeyed("http.route", "GET /admin/api/*", async (request, ctx) => {
  if ((await auth.get().verify(request, ctx)) === undefined) {
    return new Response("unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } });
  }
  // …the operator's answer
});
```

A browser's `EventSource` cannot send a header: stream server-sent events with `fetch`, which can.

## Browser sessions

It also provides `sessions` (`AdminSessions`), so the dashboard never keeps the token: it posts the
token once (admin-api's `POST /admin/api/session`) and gets a cookie instead; `DELETE` clears it.

- **The cookie**, `pikit_admin_session`: the time it expires and an HMAC-SHA256 of it, signed with a
  key derived from the token (HKDF-SHA256). The token itself is in no cookie, log line or error.
- **Its attributes:** `HttpOnly` (no script reads it), `SameSite=Strict`, `Path=/admin/api` (sent to
  the admin API only, never with the dashboard's files), `Max-Age` of 12 hours, and `Secure` when the
  request came over https, directly or through a proxy that sends `x-forwarded-proto: https`.
- **12 hours.** Past them the cookie is no operator, and the page asks for the token again.
- **State-changing methods** (any but `GET`, `HEAD`, `OPTIONS`) count the cookie only with the header
  `x-pikit-admin` (`ADMIN_CLIENT_HEADER`), which the dashboard sends and another site cannot without
  a CORS preflight the API never allows: the defence against cross-site requests, with
  `SameSite=Strict`.
- **A bearer token decides alone.** A request with an `Authorization` header is judged by it, its
  cookie ignored. Scripts keep sending the token and need no header.
- **Changing the token signs everyone out:** the key the sessions are signed with is derived from it,
  so every cookie made before stops verifying (after the restart or deploy that reads the new token).

## Guarantees

Its tests run `createAdminAuthConformance` (`@pikit/contracts/testing`): the operator's token is an
operator named `operator`; no token, a wrong one, a truncated one, another scheme is not; `verify`
never throws for a bad token and never reads the body; without the secret the start fails; and the
sessions above. Tokens are compared as SHA-256 digests in constant time, and only the digest and the
session key stay in memory.

## Replace it

Another way to sign operators in (an SSO proxy's header, Cloudflare Access) is another component that
provides `admin.auth` and passes the same suite. Routes do not change.
