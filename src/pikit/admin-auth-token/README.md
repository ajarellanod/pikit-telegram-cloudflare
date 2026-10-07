# admin-auth-token

Who is an operator: a request that carries `Authorization: Bearer <PIKIT_ADMIN_TOKEN>`. Every admin
API route (admin-api's, a component's own) asks it before answering; the dashboard's built files hold
no data and are served without it, and the page asks the operator for the token.

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

## Guarantees

Its tests run `createAdminAuthConformance` (`@pikit/contracts/testing`): the operator's token is an
operator named `operator`; no token, a wrong one, a truncated one, another scheme is not; `verify`
never throws for a bad token and never reads the body; without the secret the start fails. Tokens
are compared as SHA-256 digests in constant time, and only the digest stays in memory.

## Replace it

Another way to sign operators in (an SSO proxy's header, Cloudflare Access) is another component that
provides `admin.auth` and passes the same suite. Routes do not change.
