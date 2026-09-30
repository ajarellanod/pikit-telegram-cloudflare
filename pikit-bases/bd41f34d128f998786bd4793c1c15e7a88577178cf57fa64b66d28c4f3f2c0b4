/**
 * tool-websearch-brave: the agent tool `websearch`, for the agents that name it
 * (`tools: ["websearch"]`). It searches the web with the Brave Search API and returns the results:
 * title, address, when Brave knows it how old the page is, and a snippet.
 *
 * - **The key is a secret.** `BRAVE_API_KEY` is read through `secrets` at each call and sent only to
 *   Brave, in the `X-Subscription-Token` header. It never appears in the tool's description,
 *   parameters, answers or errors, so the model never sees it. A call without it fails, saying so.
 * - **Its replay is `"safe"`** (`agentTool`'s replay): a search only reads, so a run resumed after a crash
 *   searches again.
 * - **`apiBase`** in config is Brave's API by default; a proxy or a test double replaces it.
 *
 * Targets: `server` and `cloudflare`: it uses only `fetch`, wherever a `secrets` provider is
 * installed.
 */

import { defineComponent } from "@pikit/core";
import { agentTool } from "@pikit/pi-adapter/tools";
import Type from "typebox";

/** The secret holding the Brave Search API key (api-dashboard.search.brave.com). */
export const KEY_SECRET = "BRAVE_API_KEY";
/** Brave's web search endpoint, under `apiBase`. */
export const SEARCH_PATH = "/res/v1/web/search";
export const TIMEOUT_MS = 20_000;

const Config = Type.Object({
  /** Brave Search's API. A value, for a proxy or a test double. */
  apiBase: Type.String({ minLength: 1, default: "https://api.search.brave.com" }),
});

const Parameters = Type.Object({
  query: Type.String({ minLength: 1, description: "What to search for: words, a question, or a phrase in quotes." }),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "How many results, 1 to 20. Default: 5." })),
});

/** The part of Brave's answer the tool reads. */
interface BraveAnswer {
  web?: { results?: { title?: string; url?: string; description?: string; age?: string }[] };
}

export default defineComponent({
  name: "tool-websearch-brave",
  config: Config,
  setup(pikit, config) {
    const secrets = pikit.use("secrets");
    const endpoint = `${config.apiBase.replace(/\/+$/, "")}${SEARCH_PATH}`;

    const tool = agentTool(
      {
        name: "websearch",
        label: "Web search",
        description:
          "Searches the web (Brave Search) and returns the most relevant results: title, address, age when known, and a snippet. " +
          "Use it to find pages; read one with the fetch tool when it is installed.",
        parameters: Parameters,
        async execute(_toolCallId, params, signal) {
          const key = await secrets.get().get(KEY_SECRET);
          if (key === undefined) {
            throw new Error(`websearch: ${KEY_SECRET} is not set, so web search is unavailable. Ask whoever runs this app to add a Brave Search API key as the secret ${KEY_SECRET}.`);
          }
          const url = new URL(endpoint);
          url.searchParams.set("q", params.query);
          url.searchParams.set("count", String(params.count ?? 5));

          const timeout = AbortSignal.timeout(TIMEOUT_MS);
          let response: Response;
          try {
            response = await fetch(url, {
              headers: { accept: "application/json", "x-subscription-token": key },
              signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
            });
          } catch (error) {
            if (timeout.aborted) throw new Error(`websearch: Brave Search did not answer within ${TIMEOUT_MS / 1000} s`);
            if (signal?.aborted === true) throw error;
            throw new Error(`websearch: Brave Search could not be reached: ${error instanceof Error ? error.message : String(error)}`);
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`websearch: Brave Search answered HTTP ${response.status}${hintFor(response.status)}`);
          }

          const results = ((await response.json()) as BraveAnswer).web?.results ?? [];
          const text =
            results.length === 0
              ? `No results for "${params.query}".`
              : results
                  .map((result, index) => {
                    const title = plain(result.title ?? "") || "(untitled)";
                    const age = result.age === undefined ? "" : ` (${plain(result.age)})`;
                    return `${index + 1}. ${title}${age}\n   ${result.url ?? ""}\n   ${plain(result.description ?? "")}`.trimEnd();
                  })
                  .join("\n\n");
          return { content: [{ type: "text", text }], details: undefined };
        },
      },
      { replay: "safe" },
    );
    // Under the name the model calls it by: agents name it, and runtime-pi checks the two match.
    pikit.provideKeyed("agent.tool", "websearch", tool);
  },
});

/** What an error status most likely means, for the model to tell the user. */
function hintFor(status: number): string {
  if (status === 401 || status === 403) return `: the key in ${KEY_SECRET} was refused`;
  if (status === 429) return ": the key's rate limit or monthly quota is reached; try again later";
  return "";
}

/** Brave's snippets carry HTML (`<strong>` around matches) and character references: plain text. */
function plain(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return named[name.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}
