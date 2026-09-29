/**
 * A fake OpenRouter for tests, served on a free local port: no account, key or network needed. Set
 * its `url` as the component's `apiBase`.
 *
 * It answers OpenRouter's (OpenAI's) streamed chat completions, `POST /v1/chat/completions`, with
 * `answer: <the newest user message>`, as pikit's scripted model does, and records every request:
 * the model asked for, the key sent, the messages. Any other request is a 404.
 *
 * Test support: only tests import it (`*.test-support.ts`), so it never reaches a Worker's bundle.
 */

export interface OpenRouterRequest {
  model: string;
  /** The key sent as `Authorization: Bearer <key>`, or `undefined`. */
  apiKey: string | undefined;
  messages: { role: string; content: unknown }[];
}

export interface FakeOpenRouter {
  /** The `apiBase` to configure. */
  url: string;
  requests: OpenRouterRequest[];
  stop(): Promise<void>;
}

/** The text of a chat message's content: a string, or its text parts. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part: { type?: string; text?: string }) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("");
}

export function startFakeOpenRouter(): FakeOpenRouter {
  const requests: OpenRouterRequest[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") {
        return Response.json({ error: { code: 404, message: "Not Found" } }, { status: 404 });
      }
      const body = (await request.json()) as { model?: string; messages?: { role: string; content: unknown }[] };
      const auth = request.headers.get("authorization");
      const messages = body.messages ?? [];
      requests.push({ model: String(body.model), apiKey: auth?.startsWith("Bearer ") ? auth.slice(7) : undefined, messages });
      const newest = [...messages].reverse().find((message) => message.role === "user");
      const text = `answer: ${textOf(newest?.content)}`;

      const chunk = (choice: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
        `data: ${JSON.stringify({ id: "gen-fake", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, ...choice }], ...extra })}\n\n`;
      const events = [
        chunk({ delta: { role: "assistant", content: text }, finish_reason: null }),
        chunk({ delta: {}, finish_reason: "stop" }, { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
        "data: [DONE]\n\n",
      ];
      return new Response(events.join(""), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}
