/**
 * For the tests only: a fake GitHub reached through a `fetch` the test puts in place of the global one
 * (`globalThis.fetch = github.fetch`), so the whole connection runs with no network, in Bun and in
 * workerd alike. It does what github-app asks of GitHub, as GitHub does it:
 *
 * - **The manifest flow**: `approve(manifest)` is the operator clicking "Create GitHub App": it gives
 *   the code GitHub's redirect carries; `POST /app-manifests/{code}/conversions` answers the App once,
 *   with a private key it generated, as GitHub does: PKCS#1 PEM (`BEGIN RSA PRIVATE KEY`).
 * - **The App's JWT**, verified against that key: RS256, `iss` the client id, `iat`/`exp` within ten
 *   minutes of `now()`. `GET /app/installations/{id}`, `POST /app/installations/{id}/access_tokens`
 *   (scoped to the repositories asked, which must be the installation's).
 * - **Installation tokens**: `GET /installation/repositories`, `DELETE /installation/token`, and a
 *   repository's pull requests (`GET /repos/{owner}/{name}/pulls`), each accepting only a token that
 *   reaches it and has not expired or been revoked.
 *
 * Every request is recorded with its `authorization`, so a test can check where a credential went.
 * Only tests import it (`*.test-support.ts`).
 */

const encoder = new TextEncoder();

export interface FakeGitHubApp {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  requests: { method: string; path: string; authorization: string | null; body: unknown }[];
  /** The operator creates the App from `manifest` (the JSON the dashboard posted): the code of GitHub's redirect. */
  approve(manifest: string): string;
  /** The operator installs the App on `repositories` (`owner/name`): the installation's id. */
  install(repositories: string[], account?: string): number;
  /** The App created, once converted. */
  app(): { id: number; slug: string; clientId: string; manifest: Record<string, unknown> } | undefined;
  /** Whether `token` reaches `repository` now (an installation token, unexpired, unrevoked, scoped to it). */
  accepts(token: string, repository: string): boolean;
  /** Tokens minted, in order. */
  minted: { token: string; repositories: string[] }[];
  /** The next answers to every request: GitHub down. */
  down: boolean;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One DER element at `at`: where its content starts and ends. */
function element(der: Uint8Array, at: number): { start: number; end: number } {
  let length = der[at + 1] as number;
  let start = at + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i++) length = (length << 8) | (der[start + i] as number);
    start += count;
  }
  return { start, end: start + length };
}

/** The PKCS#1 key inside a PKCS#8 one: the third element of its sequence, an OCTET STRING. */
function pkcs1Of(pkcs8: Uint8Array): Uint8Array {
  const sequence = element(pkcs8, 0);
  const version = element(pkcs8, sequence.start);
  const algorithm = element(pkcs8, version.end);
  const key = element(pkcs8, algorithm.end);
  return pkcs8.slice(key.start, key.end);
}

const pem = (label: string, der: Uint8Array) => `-----BEGIN ${label}-----\n${(toBase64(der).match(/.{1,64}/g) ?? []).join("\n")}\n-----END ${label}-----\n`;

export async function createFakeGitHubApp(options: { now?: () => number } = {}): Promise<FakeGitHubApp> {
  const now = options.now ?? Date.now;
  const keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const privatePem = pem("RSA PRIVATE KEY", pkcs1Of(new Uint8Array((await crypto.subtle.exportKey("pkcs8", keys.privateKey)) as ArrayBuffer)));
  const codes = new Map<string, Record<string, unknown>>();
  const installations = new Map<number, { account: string; repositories: string[] }>();
  const tokens = new Map<string, { installation: number; repositories: string[]; expiresAt: number; revoked: boolean }>();
  let created: { id: number; slug: string; clientId: string; manifest: Record<string, unknown> } | undefined;
  let serial = 0;

  const answer = (status: number, body?: unknown) => (body === undefined ? new Response(null, { status }) : Response.json(body, { status }));
  const refuse = (status: number, message: string) => answer(status, { message });

  /** Whether `authorization` is a JWT of the App, valid now. */
  const isAppJwt = async (authorization: string | null): Promise<boolean> => {
    if (created === undefined || authorization === null || !authorization.startsWith("Bearer ")) return false;
    const [header, payload, signature] = authorization.slice(7).split(".");
    if (header === undefined || payload === undefined || signature === undefined) return false;
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keys.publicKey, fromBase64Url(signature), new Uint8Array(encoder.encode(`${header}.${payload}`)));
    if (!ok) return false;
    const head = JSON.parse(new TextDecoder().decode(fromBase64Url(header))) as { alg?: string };
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { iat?: number; exp?: number; iss?: string };
    const seconds = now() / 1000;
    return (
      head.alg === "RS256" &&
      claims.iss === created.clientId &&
      typeof claims.iat === "number" &&
      typeof claims.exp === "number" &&
      claims.iat <= seconds + 60 &&
      claims.exp > seconds &&
      claims.exp - claims.iat <= 660
    );
  };

  const installationToken = (authorization: string | null) => {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    const found = token === undefined ? undefined : tokens.get(token);
    return found === undefined || found.revoked || found.expiresAt <= now() ? undefined : { token: token as string, ...found };
  };

  const fake: FakeGitHubApp = {
    requests: [],
    minted: [],
    down: false,
    approve(manifest) {
      const code = `code${++serial}`;
      codes.set(code, JSON.parse(manifest) as Record<string, unknown>);
      return code;
    },
    install(repositories, account = "ana") {
      const id = 1000 + ++serial;
      installations.set(id, { account, repositories });
      return id;
    },
    app: () => created,
    accepts(token, repository) {
      const found = installationToken(`Bearer ${token}`);
      return found !== undefined && found.repositories.some((each) => each.toLowerCase() === repository.toLowerCase());
    },
    async fetch(input, init) {
      const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      const url = new URL(request.url);
      const authorization = request.headers.get("authorization");
      const raw = await request.text();
      const body = raw === "" ? undefined : (JSON.parse(raw) as unknown);
      fake.requests.push({ method: request.method, path: `${url.pathname}${url.search}`, authorization, body });
      if (url.origin !== "https://api.github.com") return refuse(404, "Not Found");
      if (fake.down) return refuse(503, "Service unavailable");
      const path = url.pathname;
      let match: RegExpExecArray | null;

      if ((match = /^\/app-manifests\/([^/]+)\/conversions$/.exec(path)) !== null && request.method === "POST") {
        const manifest = codes.get(match[1] as string);
        if (manifest === undefined) return refuse(404, "Not Found");
        codes.delete(match[1] as string);
        const slug = String(manifest.name);
        created = { id: 4242, slug, clientId: "Iv23liFakeClientId", manifest };
        return answer(201, {
          id: created.id,
          slug,
          name: slug,
          node_id: "A_fake",
          owner: { login: "ana", type: "User" },
          client_id: created.clientId,
          client_secret: "fake-client-secret-never-shown",
          webhook_secret: null,
          pem: privatePem,
          html_url: `https://github.com/apps/${slug}`,
        });
      }
      if ((match = /^\/app\/installations\/(\d+)$/.exec(path)) !== null && request.method === "GET") {
        if (!(await isAppJwt(authorization))) return refuse(401, "A JSON web token could not be decoded");
        const installation = installations.get(Number(match[1]));
        if (installation === undefined) return refuse(404, "Not Found");
        return answer(200, { id: Number(match[1]), account: { login: installation.account }, repository_selection: "selected", app_id: created?.id });
      }
      if ((match = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path)) !== null && request.method === "POST") {
        if (!(await isAppJwt(authorization))) return refuse(401, "A JSON web token could not be decoded");
        const id = Number(match[1]);
        const installation = installations.get(id);
        if (installation === undefined) return refuse(404, "Not Found");
        const asked = (body as { repositories?: string[] } | undefined)?.repositories;
        const repositories = asked === undefined ? installation.repositories : installation.repositories.filter((each) => asked.includes(each.split("/")[1] as string));
        if (asked !== undefined && repositories.length !== asked.length) return refuse(422, "There is at least one repository that does not exist or is not accessible to the parent installation.");
        const token = `ghs_fake${++serial}${"x".repeat(20)}`;
        const expiresAt = now() + 60 * 60 * 1000;
        tokens.set(token, { installation: id, repositories, expiresAt, revoked: false });
        fake.minted.push({ token, repositories });
        return answer(201, { token, expires_at: new Date(expiresAt).toISOString(), repository_selection: "selected" });
      }
      if (path === "/installation/repositories" && request.method === "GET") {
        const found = installationToken(authorization);
        if (found === undefined) return refuse(401, "Bad credentials");
        return answer(200, { total_count: found.repositories.length, repositories: found.repositories.map((full) => ({ full_name: full, name: full.split("/")[1] })) });
      }
      if (path === "/installation/token" && request.method === "DELETE") {
        const found = installationToken(authorization);
        if (found === undefined) return refuse(401, "Bad credentials");
        (tokens.get(found.token) as { revoked: boolean }).revoked = true;
        return answer(204);
      }
      if ((match = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(path)) !== null && request.method === "GET") {
        const found = installationToken(authorization);
        if (found === undefined) return refuse(401, "Bad credentials");
        if (!found.repositories.some((each) => each.toLowerCase() === (match?.[1] as string).toLowerCase())) return refuse(404, "Not Found");
        return answer(200, [{ number: 1, head: { ref: "pikit/self/a" } }]);
      }
      return refuse(404, "Not Found");
    },
  };
  return fake;
}
