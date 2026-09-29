/**
 * tool-fetch's tests. They are copied with the component and keep running in your project. The web
 * is a local server on a free port (`Bun.serve`): no test reaches the network.
 */

import { afterAll, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, defineApp, defineComponent, silentLogger, withCancel } from "@pikit/core";
import type { AgentTool } from "@pikit/contracts";
import { toolComponent } from "@pikit/pi-adapter/tools";
import toolFetch, { createFetchTool, MAX_OUTPUT } from "./index.ts";

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

/** Every request the fake web received: method, path, headers and body. */
const received: { method: string; path: string; headers: Headers; body: string }[] = [];
const PAGE = `<!doctype html><html><head><title>Docs &amp; notes</title><style>.hidden{}</style><script>var secret = 1;</script></head>
<body><h1>Welcome</h1><p>Read the <a href="/guide">guide&nbsp;here</a> or <a href="https://example.org/x">elsewhere</a>.</p>
<p>Fish &amp; chips &#8212; <a href="#top">top</a> <a href="javascript:void(0)">nothing</a></p><ul><li>one</li><li>two</li></ul>
<table><tr><th>name</th><th>size</th></tr><tr><td>a.txt</td><td>3</td></tr></table></body></html>`;

const web = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    received.push({ method: request.method, path: url.pathname, headers: request.headers, body: await request.text() });
    switch (url.pathname) {
      case "/page":
        return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      case "/data":
        return Response.json({ name: "pikit", tags: ["a", "b"] });
      case "/image":
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), { headers: { "content-type": "image/png" } });
      case "/plain":
        return new Response("just text", { headers: { "content-type": "text/plain" } });
      case "/untyped-binary":
        return new Response(new Uint8Array([1, 2, 0, 3]));
      case "/large":
        return new Response("x".repeat(3000), { headers: { "content-type": "text/plain" } });
      case "/huge":
        return new Response("y".repeat(MAX_OUTPUT + 10_000), { headers: { "content-type": "text/plain" } });
      case "/moved":
        return Response.redirect(new URL("/plain", request.url).href, 302);
      case "/echo":
        return Response.json({ method: request.method, body: received.at(-1)?.body });
      case "/missing":
        return new Response("no such thing", { status: 404, headers: { "content-type": "text/plain" } });
      case "/slow":
        return new Promise<Response>(() => {}); // never answers
      default:
        return new Response("?", { status: 400 });
    }
  },
});
const origin = `http://127.0.0.1:${web.port}`;
afterAll(() => web.stop(true));

/** The tool as an installed component provides it, in a started app. */
async function installed(component = toolFetch): Promise<{ tool: AgentTool; stop(): Promise<void> }> {
  let tool: AgentTool | undefined;
  const reader = defineComponent({
    name: "tool-reader",
    setup(pikit) {
      const tools = pikit.useKeyed("agent.tool");
      return { start: () => void (tool = tools.get("fetch")) };
    },
  });
  const app = await defineApp({ components: [component, reader], logger: silentLogger }).create();
  await app.start();
  if (tool === undefined) throw new Error("agent.tool fetch was not provided");
  return { tool, stop: () => app.stop() };
}

async function call(params: Record<string, unknown>, tool?: AgentTool): Promise<string> {
  const s = tool === undefined ? await installed() : undefined;
  try {
    return textOf(await (tool ?? (s as { tool: AgentTool }).tool).execute("call-1", params, () => {}, undefined, invocation, BACKGROUND_CONTEXT));
  } finally {
    await s?.stop();
  }
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [toolFetch], logger: silentLogger }).create();

  expect(app.describe().components).toEqual([{ name: "tool-fetch", provides: ["agent.tool"], requires: [], optional: [] }]);
  expect(app.describe().capabilities["agent.tool"]?.keys).toEqual({ fetch: "tool-fetch" });
});

test("it provides the tool fetch with replay never, whose description asks to confirm what is not a GET", async () => {
  const s = await installed();
  const tool = s.tool as unknown as { name: string; replay: string; description: string };

  expect([tool.name, tool.replay]).toEqual(["fetch", "never"]);
  expect(tool.description).toContain("wait for their confirmation");
  await s.stop();
});

test("an HTML page comes back as its title, readable text and absolute links, without head or scripts", async () => {
  const text = await call({ url: `${origin}/page` });

  expect(text).toStartWith(`HTTP 200 OK · text/html; charset=utf-8 · ${origin}/page`);
  expect(text).toContain("# Docs & notes");
  expect(text).toContain("Welcome\nRead the guide here or elsewhere.");
  expect(text).toContain("Fish & chips \u2014 top nothing");
  expect(text).toContain("one\ntwo"); // blocks on their own lines
  expect(text).toContain("name size\na.txt 3"); // a table's cells apart, its rows on their own lines
  expect(text).toContain(`Links:\n- guide here: ${origin}/guide\n- elsewhere: https://example.org/x`);
  expect(text).not.toContain("var secret");
  expect(text).not.toContain(".hidden");
  expect(text).not.toContain("#top");
  expect(text).not.toContain("javascript:");
});

test("raw: true gives the HTML as it is", async () => {
  expect(await call({ url: `${origin}/page`, raw: true })).toContain("<script>var secret = 1;</script>");
});

test("JSON comes back pretty-printed; other text as it is; an error status is reported, not thrown", async () => {
  expect(await call({ url: `${origin}/data` })).toEndWith(`\n\n${JSON.stringify({ name: "pikit", tags: ["a", "b"] }, null, 2)}`);
  expect(await call({ url: `${origin}/plain` })).toEndWith("\n\njust text");
  expect(await call({ url: `${origin}/missing` })).toStartWith("HTTP 404 Not Found");
});

test("binary content is refused, by its content type or by its bytes when it has none", async () => {
  const typed = await call({ url: `${origin}/image` });
  const untyped = await call({ url: `${origin}/untyped-binary` });

  expect(typed).toContain("image/png");
  expect(typed).toContain("(binary content, 8 bytes: not shown");
  expect(typed).not.toContain("PNG");
  expect(untyped).toContain("binary content");
});

test("redirects are followed, and the answer names where it ended", async () => {
  expect(await call({ url: `${origin}/moved` })).toStartWith(`HTTP 200 OK · text/plain · ${origin}/plain`);
});

test("POST sends its body and headers; HEAD returns the status and headers; no credential of its own is sent", async () => {
  const posted = await call({ url: `${origin}/echo`, method: "POST", headers: { "content-type": "application/json", "x-trace": "7" }, body: '{"a":1}' });
  const request = received.at(-1);
  const head = await call({ url: `${origin}/plain`, method: "HEAD" });

  expect(posted).toContain('"method": "POST"');
  expect(posted).toContain('"body": "{\\"a\\":1}"');
  expect(request?.headers.get("x-trace")).toBe("7");
  expect(request?.headers.get("user-agent")).toStartWith("pikit-fetch");
  expect(request?.headers.get("authorization")).toBeNull();
  expect(request?.headers.get("cookie")).toBeNull();
  expect(head).toStartWith("HTTP 200 OK · text/plain");
  expect(head).toContain("content-type: text/plain");
});

test("it refuses what is not http(s), a method it does not allow, and a body on a GET", async () => {
  const s = await installed();
  const run = (params: Record<string, unknown>) => s.tool.execute("call-1", params, () => {}, undefined, invocation, BACKGROUND_CONTEXT);

  await expect(run({ url: "file:///etc/passwd" })).rejects.toThrow("only http:// and https://");
  await expect(run({ url: "not a url" })).rejects.toThrow("is not a URL");
  await expect(run({ url: `${origin}/plain`, method: "TRACE" })).rejects.toThrow("the method TRACE is not allowed");
  await expect(run({ url: `${origin}/plain`, body: "x" })).rejects.toThrow("a GET request has no body");
  await s.stop();
});

test("it reads at most its limit of the body, and says so", async () => {
  const s = await installed(toolComponent(createFetchTool({ maxBytes: 1000 }), { replay: "never" }));
  const text = await call({ url: `${origin}/large` }, s.tool);

  expect(text).toContain("(only the first 1000 bytes were read)");
  expect(text).toEndWith(`\n\n${"x".repeat(1000)}`);
  await s.stop();
});

test("the model gets at most MAX_OUTPUT characters, and how many more there were", async () => {
  const text = await call({ url: `${origin}/huge` });

  expect(text).toMatch(/\n\n\(\u2026 \d+ more characters not shown\)$/);
  expect(text.length).toBeLessThan(MAX_OUTPUT + 100);
});

test("it gives up at its timeout, and stops when the run is cancelled", async () => {
  const s = await installed(toolComponent(createFetchTool({ timeoutMs: 200 }), { replay: "never" }));
  await expect(s.tool.execute("call-1", { url: `${origin}/slow` }, () => {}, undefined, invocation, BACKGROUND_CONTEXT)).rejects.toThrow(
    `127.0.0.1:${web.port} did not answer within 0.2 s`,
  );
  await s.stop();

  const patient = await installed();
  const { context, cancel } = withCancel(BACKGROUND_CONTEXT);
  const pending = patient.tool.execute("call-2", { url: `${origin}/slow` }, () => {}, undefined, invocation, context);
  setTimeout(cancel, 50);
  await expect(pending).rejects.toThrow();
  await patient.stop();
});
