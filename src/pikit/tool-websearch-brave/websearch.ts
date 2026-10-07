/**
 * The `websearch` tool, written with `defineTool` (pi-durable's, from `@pikit/pi-adapter/tools`). It
 * searches the web with the Brave Search API and returns title, address, age when Brave knows it, and
 * a snippet.
 *
 * - **The key is a secret.** `apiKey()` is asked at each call (the component reads `BRAVE_API_KEY`
 *   through `secrets`) and the key is sent only to Brave, in `X-Subscription-Token`. It is in no
 *   description, parameter, result, detail, diagnostic or error, and nothing about the call is kept
 *   in a memo: the transcript, which pi-durable stores and the model reads, never holds it.
 * - **Replay `"safe"`**: a search only reads, so an interrupted call searches again on recovery.
 */

import { defineTool, type ToolRegistration } from "@pikit/pi-adapter/tools";
import Type from "typebox";

/** The secret holding the Brave Search API key (api-dashboard.search.brave.com). */
export const BRAVE_KEY_SECRET = "BRAVE_API_KEY";
/** Brave's web search endpoint, under `apiBase`. */
export const BRAVE_SEARCH_PATH = "/res/v1/web/search";
export const BRAVE_TIMEOUT_MS = 20_000;

const Parameters = Type.Object({
  query: Type.String({ minLength: 1, description: "What to search for: words, a question, or a phrase in quotes." }),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "How many results, 1 to 20. Default: 5." })),
});

/** The part of Brave's answer the tool reads. */
interface BraveAnswer {
  web?: { results?: { title?: string; url?: string; description?: string; age?: string }[] };
}

export interface BraveSearchToolOptions {
  /** The API key, asked at each call; `undefined` when it is not set (the call fails, saying so). */
  apiKey(): Promise<string | undefined>;
  /** Brave Search's API. Default: `https://api.search.brave.com`; a proxy or a test double replaces it. */
  apiBase?: string;
  /** How long Brave may take to answer. Default: 20 s. */
  timeoutMs?: number;
}

/** The `websearch` tool, over Brave Search. */
export function createBraveSearchTool(options: BraveSearchToolOptions): ToolRegistration<typeof Parameters> {
  const endpoint = `${(options.apiBase ?? "https://api.search.brave.com").replace(/\/+$/, "")}${BRAVE_SEARCH_PATH}`;
  const timeoutMs = options.timeoutMs ?? BRAVE_TIMEOUT_MS;
  return defineTool({
    name: "websearch",
    description:
      "Searches the web (Brave Search) and returns the most relevant results: title, address, age when known, and a snippet. " +
      "Use it to find pages; read one with the fetch tool when it is installed.",
    parameters: Parameters,
    replay: "safe",
    async execute(args, _api, context) {
      const signal = context.abortSignal;
      const key = await options.apiKey();
      if (key === undefined) {
        throw new Error(`websearch: ${BRAVE_KEY_SECRET} is not set, so web search is unavailable. Ask whoever runs this app to add a Brave Search API key as the secret ${BRAVE_KEY_SECRET}.`);
      }
      const url = new URL(endpoint);
      url.searchParams.set("q", args.query);
      url.searchParams.set("count", String(args.count ?? 5));

      const timeout = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { accept: "application/json", "x-subscription-token": key },
          signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        });
      } catch (error) {
        if (timeout.aborted) throw new Error(`websearch: Brave Search did not answer within ${timeoutMs / 1000} s`);
        if (signal?.aborted === true) throw error;
        throw new Error(`websearch: Brave Search could not be reached: ${redact(error instanceof Error ? error.message : String(error), key)}`);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`websearch: Brave Search answered HTTP ${response.status}${hintFor(response.status)}`);
      }

      const results = ((await response.json()) as BraveAnswer).web?.results ?? [];
      const text =
        results.length === 0
          ? `No results for "${args.query}".`
          : results
              .map((result, index) => {
                const title = plain(result.title ?? "") || "(untitled)";
                const age = result.age === undefined ? "" : ` (${plain(result.age)})`;
                return `${index + 1}. ${title}${age}\n   ${result.url ?? ""}\n   ${plain(result.description ?? "")}`.trimEnd();
              })
              .join("\n\n");
      return { content: [{ type: "text", text: redact(text, key) }] };
    },
  });
}

/** What an error status most likely means, for the model to tell the user. */
function hintFor(status: number): string {
  if (status === 401 || status === 403) return `: the key in ${BRAVE_KEY_SECRET} was refused`;
  if (status === 429) return ": the key's rate limit or monthly quota is reached; try again later";
  return "";
}

/** `text` without `key`: neither an error a platform builds nor an answer that echoes it shows it. */
function redact(text: string, key: string): string {
  return key === "" ? text : text.replaceAll(key, "[redacted]");
}

/** Brave's snippets carry HTML (`<strong>` around matches) and character references: plain text. */
function plain(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** HTML's character references (`&amp;`, `&#39;`, `&#x2014;`) as the characters they stand for. */
function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return named[name.toLowerCase()] ?? entity;
  });
}
