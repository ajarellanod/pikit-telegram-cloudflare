/**
 * For the tests only: a fake GitHub, reached through a `fetch` the test puts in place of the global
 * one, so `git clone` and `git push` run end to end with no network. It speaks git's smart HTTP
 * protocol (v1, side-band-64k, shallow) as far as isomorphic-git uses it. Its repositories are real
 * ones, made with isomorphic-git in `storage`'s files under `/srv/github`.
 *
 * It records what reached it, so a test can check where the token went, and keeps what is pushed:
 * the pushed branch points to the pushed commit.
 */

import git from "isomorphic-git";
import { createFiles, type DurableObjectFilesStorage } from "./files.ts";
import { gitFs } from "./git.ts";

export interface FakeRepository {
  /** The files of its first commit; a second commit changes `README.md`, so a shallow clone has history to skip. */
  files: Record<string, string>;
  /** Reading it needs the token, as a private repository does. */
  private?: boolean;
}

export interface FakeGitHub {
  /** Put it in place of the global `fetch`: `globalThis.fetch = github.fetch as typeof fetch`. */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** Every request, and the `Authorization` it carried. */
  requests: { method: string; url: string; authorization: string | null }[];
  pushes: { repository: string; ref: string; oid: string; packBytes: number }[];
  /** The latest commit of `owner/name`'s `main`. */
  head(repository: string): Promise<string>;
  /** The commit `owner/name`'s `branch` points to; `undefined` when it has none. */
  branch(repository: string, branch: string): Promise<string | undefined>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AUTHOR = { name: "fake github", email: "fake@github.invalid", timestamp: 1_700_000_000, timezoneOffset: 0 };

/** One pkt-line: its length in four hex digits (itself included), then the data. */
function pkt(data: string | Uint8Array): Uint8Array {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const out = new Uint8Array(bytes.length + 4);
  out.set(encoder.encode((bytes.length + 4).toString(16).padStart(4, "0")));
  out.set(bytes, 4);
  return out;
}
const FLUSH = encoder.encode("0000");

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `data` on side-band channel 1, in packets small enough for side-band-64k. */
function band(data: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  for (let at = 0; at < data.length; at += 65_000) packets.push(pkt(concat([Uint8Array.of(1), data.subarray(at, at + 65_000)])));
  return packets;
}

export async function createFakeGitHub(storage: DurableObjectFilesStorage, repositories: Record<string, FakeRepository>, token?: string): Promise<FakeGitHub> {
  const files = createFiles(() => storage);
  files.migrate();
  const fs = gitFs(files);
  const dirOf = (repository: string) => `/srv/github/${repository.toLowerCase()}`;
  for (const [repository, spec] of Object.entries(repositories)) {
    const dir = dirOf(repository);
    files.mkdirp(dir);
    await git.init({ fs, dir, defaultBranch: "main" });
    for (const [path, content] of Object.entries(spec.files)) {
      files.mkdirp(`${dir}/${path}`.slice(0, `${dir}/${path}`.lastIndexOf("/")));
      files.write(`${dir}/${path}`, encoder.encode(content));
      await git.add({ fs, dir, filepath: path });
    }
    await git.commit({ fs, dir, message: "first commit", author: AUTHOR });
    files.write(`${dir}/README.md`, encoder.encode(`${spec.files["README.md"] ?? ""}(second commit)\n`));
    await git.add({ fs, dir, filepath: "README.md" });
    await git.commit({ fs, dir, message: "second commit", author: { ...AUTHOR, timestamp: AUTHOR.timestamp + 60 } });
  }
  const expected = token === undefined ? undefined : `Basic ${btoa(`x-access-token:${token}`)}`;

  const fake: FakeGitHub = {
    requests: [],
    pushes: [],
    head: (repository) => git.resolveRef({ fs, dir: dirOf(repository), ref: "refs/heads/main" }),
    branch: (repository, branch) => git.resolveRef({ fs, dir: dirOf(repository), ref: `refs/heads/${branch}` }).catch(() => undefined),
    async fetch(input, init) {
      const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      const authorization = request.headers.get("authorization");
      fake.requests.push({ method: request.method, url: request.url, authorization });
      const url = new URL(request.url);
      const authorized = expected !== undefined && authorization === expected;

      const match = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(url.pathname);
      const repository = match === null ? undefined : `${match[1]}/${match[2]}`;
      const spec = repository === undefined ? undefined : Object.entries(repositories).find(([name]) => name.toLowerCase() === repository.toLowerCase())?.[1];
      if (url.host !== "github.com" || match === null || repository === undefined || spec === undefined) return new Response("Not Found", { status: 404 });
      const service = match[3] === "info/refs" ? url.searchParams.get("service") : match[3];
      // GitHub wants credentials for a private repository, and for any push.
      if ((spec.private === true || service === "git-receive-pack") && !authorized) {
        return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": 'Basic realm="GitHub"' } });
      }
      const dir = dirOf(repository);
      const head = await git.resolveRef({ fs, dir, ref: "refs/heads/main" });

      if (match[3] === "info/refs") {
        const caps = service === "git-upload-pack" ? "side-band-64k shallow symref=HEAD:refs/heads/main agent=fake-github" : "report-status side-band-64k agent=fake-github";
        const refs = service === "git-upload-pack" ? [`${head} HEAD\0${caps}\n`, `${head} refs/heads/main\n`] : [`${head} refs/heads/main\0${caps}\n`];
        const body = concat([pkt(`# service=${service}\n`), FLUSH, ...refs.map(pkt), FLUSH]);
        return new Response(body, { headers: { "content-type": `application/x-${service}-advertisement` } });
      }

      const sent = new Uint8Array(await request.arrayBuffer());
      if (service === "git-upload-pack") {
        const text = decoder.decode(sent);
        const wants = [...text.matchAll(/want ([0-9a-f]{40})/g)].map((found) => found[1] ?? "");
        const depth = Number(/deepen (\d+)/.exec(text)?.[1] ?? Number.POSITIVE_INFINITY);
        const oids = new Set<string>();
        const shallow: string[] = [];
        const addTree = async (oid: string): Promise<void> => {
          oids.add(oid);
          for (const entry of (await git.readTree({ fs, dir, oid })).tree) {
            if (entry.type === "tree") await addTree(entry.oid);
            else if (entry.type === "blob") oids.add(entry.oid);
          }
        };
        const addCommit = async (oid: string, level: number): Promise<void> => {
          if (oids.has(oid)) return;
          oids.add(oid);
          const { commit } = await git.readCommit({ fs, dir, oid });
          await addTree(commit.tree);
          if (level >= depth) {
            if (commit.parent.length > 0) shallow.push(oid);
            return;
          }
          for (const parent of commit.parent) await addCommit(parent, level + 1);
        };
        for (const want of wants) await addCommit(want, 1);
        const { packfile } = await git.packObjects({ fs, dir, oids: [...oids] });
        if (packfile === undefined) throw new Error("fake github: no packfile");
        const lines = Number.isFinite(depth) ? [...shallow.map((oid) => pkt(`shallow ${oid}\n`)), FLUSH] : [];
        return new Response(concat([...lines, pkt("NAK\n"), ...band(packfile), FLUSH]), { headers: { "content-type": "application/x-git-upload-pack-result" } });
      }

      // git-receive-pack: the first line is `<old> <new> <ref>\0<caps>`, then a flush, then the packfile.
      const length = Number.parseInt(decoder.decode(sent.subarray(0, 4)), 16);
      const [, oid = "", ref = ""] = decoder.decode(sent.subarray(4, length)).split("\0")[0]?.trim().split(" ") ?? [];
      const pack = sent.subarray(length + 4);
      fake.pushes.push({ repository, ref, oid, packBytes: pack.length });
      // Kept as GitHub keeps it: the pack indexed into the repository, the branch moved to the commit.
      if (pack.length > 0) {
        const name = `pack-${[...pack.subarray(pack.length - 20)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}.pack`;
        files.mkdirp(`${dir}/.git/objects/pack`);
        files.write(`${dir}/.git/objects/pack/${name}`, pack.slice());
        await git.indexPack({ fs, dir, filepath: `.git/objects/pack/${name}` });
      }
      await git.writeRef({ fs, dir, ref, value: oid, force: true });
      const report = concat([pkt("unpack ok\n"), pkt(`ok ${ref}\n`), FLUSH]);
      return new Response(concat([...band(report), FLUSH]), { headers: { "content-type": "application/x-git-receive-pack-result" } });
    },
  };
  return fake;
}
