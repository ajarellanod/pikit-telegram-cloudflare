/**
 * tool-websearch-brave's tests. They are copied with the component and keep running in your project.
 * Brave is a local stand-in of its web search API on a free port (`Bun.serve`), reached through
 * `apiBase`: no test reaches the network or needs a real key.
 */

import { afterAll, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, defineApp, defineComponent, silentLogger } from "@pikit/core";
import type { AgentTool } from "@pikit/contracts";
import toolWebsearchBrave, { KEY_SECRET, SEARCH_PATH } from "./index.ts";

const KEY = "brave-test-key-0123456789";

/** What Pi passes to a tool call; a direct call has no run to identify. */
const invocation = {
  invocationId: "invocation-1",
  operationId: "operation-1",
  turnId: "turn-1",
  getMemo: async () => undefined,
  setMemo: async () => {},
};

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : [])).join("");
}

/** The requests the fake Brave received, and what it answers next. */
const received: { path: string; query: URLSearchParams; token: string | null }[] = [];
let answer: () => Response = () => Response.json({});

const brave = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url);
    received.push({ path: url.pathname, query: url.searchParams, token: request.headers.get("x-subscription-token") });
    // As Brave: a request without the right token is refused.
    if (request.headers.get("x-subscription-token") !== KEY) return Response.json({ type: "ErrorResponse" }, { status: 401 });
    return answer();
  },
});
const apiBase = `http://127.0.0.1:${brave.port}`;
afterAll(() => brave.stop(true));

/** A `secrets` provider over `values`, as `secrets-env` over the environment. */
function secretsOf(values: Record<string, string>) {
  return defineComponent({ name: "secrets-test", setup: (pikit) => pikit.provide("secrets", { get: async (name) => values[name] }) });
}

/** The tool as installed in a started app, against the fake Brave, with `secrets`. */
async function installed(secrets: Record<string, string> = { [KEY_SECRET]: KEY }): Promise<{ tool: AgentTool; stop(): Promise<void> }> {
  let tool: AgentTool | undefined;
  const reader = defineComponent({
    name: "tool-reader",
    setup(pikit) {
      const tools = pikit.useKeyed("agent.tool");
      return { start: () => void (tool = tools.get("websearch")) };
    },
  });
  const app = await defineApp({
    components: [secretsOf(secrets), toolWebsearchBrave, reader],
    config: { "tool-websearch-brave": { apiBase } },
    logger: silentLogger,
  }).create();
  await app.start();
  if (tool === undefined) throw new Error("agent.tool websearch was not provided");
  return { tool, stop: () => app.stop() };
}

const search = (tool: AgentTool, params: Record<string, unknown>) => tool.execute("call-1", params, () => {}, undefined, invocation, BACKGROUND_CONTEXT);

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [secretsOf({}), toolWebsearchBrave], logger: silentLogger }).create();

  expect(app.describe().components.find((component) => component.name === "tool-websearch-brave")).toMatchObject({
    provides: ["agent.tool"],
    requires: ["secrets"],
    optional: [],
  });
  expect(app.describe().capabilities["agent.tool"]?.keys).toEqual({ websearch: "tool-websearch-brave" });
});

test("it provides the tool websearch with replay safe", async () => {
  const s = await installed();

  expect([s.tool.name, (s.tool as unknown as { replay: string }).replay]).toEqual(["websearch", "safe"]);
  await s.stop();
});

test("it asks Brave with the key from secrets and returns the results as plain text", async () => {
  answer = () =>
    Response.json({
      web: {
        results: [
          { title: "pikit &amp; <strong>Pi</strong>", url: "https://example.org/pikit", description: "A kit for <strong>agents</strong> &#8212; small.", age: "2 days ago" },
          { title: "Second", url: "https://example.org/2", description: "" },
        ],
      },
    });
  const s = await installed();
  const text = textOf(await search(s.tool, { query: "pikit agents", count: 2 }));
  const request = received.at(-1);

  expect(request?.path).toBe(SEARCH_PATH);
  expect(request?.query.get("q")).toBe("pikit agents");
  expect(request?.query.get("count")).toBe("2");
  expect(request?.token).toBe(KEY);
  expect(text).toBe("1. pikit & Pi (2 days ago)\n   https://example.org/pikit\n   A kit for agents \u2014 small.\n\n2. Second\n   https://example.org/2");
  await s.stop();
});

test("five results by default, and a search with none says so", async () => {
  answer = () => Response.json({ web: { results: [] } });
  const s = await installed();
  const text = textOf(await search(s.tool, { query: "zzqx" }));

  expect(received.at(-1)?.query.get("count")).toBe("5");
  expect(text).toBe('No results for "zzqx".');
  await s.stop();
});

test("without BRAVE_API_KEY it fails clearly, and asks Brave nothing", async () => {
  const s = await installed({});
  const before = received.length;

  await expect(search(s.tool, { query: "pikit" })).rejects.toThrow("websearch: BRAVE_API_KEY is not set");
  expect(received.length).toBe(before);
  await s.stop();
});

test("a refused key or a quota fails with Brave's status, and never shows the key", async () => {
  const refused = await installed({ [KEY_SECRET]: "wrong-key" });
  const error = await search(refused.tool, { query: "pikit" }).then(
    () => new Error("it answered"),
    (reason: unknown) => reason as Error,
  );
  await refused.stop();

  expect(error.message).toBe("websearch: Brave Search answered HTTP 401: the key in BRAVE_API_KEY was refused");
  expect(error.message).not.toContain("wrong-key");

  answer = () => new Response("slow down", { status: 429 });
  const limited = await installed();
  await expect(search(limited.tool, { query: "pikit" })).rejects.toThrow("HTTP 429: the key's rate limit or monthly quota is reached");
  await limited.stop();
});

test("the key reaches only Brave: nothing the model sees contains it", async () => {
  answer = () => Response.json({ web: { results: [{ title: "t", url: "https://example.org", description: "d" }] } });
  const s = await installed();
  const result = await search(s.tool, { query: "pikit" });

  expect(JSON.stringify({ tool: s.tool, result })).not.toContain(KEY);
  await s.stop();
});
