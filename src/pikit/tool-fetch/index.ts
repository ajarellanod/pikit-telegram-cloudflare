/**
 * tool-fetch: the agent tool `fetch`, for the agents that name it (`tools: ["fetch"]`). It makes one
 * HTTP(S) request to a web page or an API and returns what came back, as text the model can read:
 * - HTML as readable text (title, text by blocks, no scripts or styles) and its links, absolute;
 * - JSON pretty-printed; other text as it is;
 * - binary content (images, PDFs, archives) refused, unread.
 *
 * Its limits keep one call cheap on both targets: 20 s for the whole call, at most 2 MB read from the
 * body (the rest is never downloaded), and at most 50,000 characters given back to the model.
 *
 * It carries no credentials: it adds no cookie, token or key of its own, so the agent reaches only
 * what anyone could, plus the headers it writes itself.
 *
 * Its replay is `"never"` (SPEC §8.4): a POST, PUT, PATCH or DELETE may have had its effect before a
 * crash, so a resumed run is told the call was interrupted instead of sending it twice.
 *
 * Targets: `server` and `cloudflare`: it uses only `fetch`, streams and `HTMLRewriter`, which Workers
 * and Bun both have.
 */

import { type ToolDefinition, toolComponent } from "@pikit/pi-adapter/tools";
import Type from "typebox";

export const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
export const TIMEOUT_MS = 20_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_OUTPUT = 50_000;
/** Links listed after an HTML page's text, at most. */
const MAX_LINKS = 100;
const USER_AGENT = "pikit-fetch/0 (an AI agent's HTTP tool)";

const Parameters = Type.Object({
  url: Type.String({ description: "The address to request: http:// or https:// only." }),
  method: Type.Optional(Type.Enum([...METHODS], { description: "GET (the default), HEAD, POST, PUT, PATCH or DELETE." })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Request headers, by name." })),
  body: Type.Optional(Type.String({ description: "The request body, for POST, PUT, PATCH or DELETE." })),
  raw: Type.Optional(Type.Boolean({ description: "true: HTML as it is, not converted to text." })),
});

export interface FetchToolOptions {
  /** How long the whole call may take, answer and body. Default: 20 s. */
  timeoutMs?: number;
  /** How much of the body is read, at most. Default: 2 MB. */
  maxBytes?: number;
}

/** The `fetch` tool, in the shape of Pi's `defineTool`. Tests pass shorter limits. */
export function createFetchTool(options: FetchToolOptions = {}): ToolDefinition<typeof Parameters> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  return {
    name: "fetch",
    label: "Fetch",
    description:
      "Makes one HTTP(S) request to a web page or an API and returns its status and content: HTML as readable text with its links, " +
      "JSON pretty-printed, other text as it is. Binary content (images, PDFs, archives) is not returned. GET by default. " +
      "Any method other than GET or HEAD (POST, PUT, PATCH, DELETE) may change something: before using one, tell the user what you " +
      "will send and where, and wait for their confirmation. It sends no credentials of its own. " +
      `It gives up after ${timeoutMs / 1000} s and reads at most ${formatBytes(maxBytes)}.`,
    parameters: Parameters,
    async execute(_toolCallId, params, signal) {
      const url = httpUrl(params.url);
      const method = params.method ?? "GET";
      if (!(METHODS as readonly string[]).includes(method)) throw new Error(`fetch: the method ${method} is not allowed; use one of ${METHODS.join(", ")}`);
      if (params.body !== undefined && (method === "GET" || method === "HEAD")) throw new Error(`fetch: a ${method} request has no body`);

      // One deadline for the answer and the body; the run's cancellation stops it too.
      const timeout = AbortSignal.timeout(timeoutMs);
      const headers = new Headers(params.headers);
      if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
      const init: RequestInit = {
        method,
        headers,
        redirect: "follow",
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      };
      if (params.body !== undefined) init.body = params.body;
      try {
        return { content: [{ type: "text", text: clip(await request(url, init, method, maxBytes, params.raw === true)) }], details: undefined };
      } catch (error) {
        if (timeout.aborted) throw new Error(`fetch: ${url.host} did not answer within ${timeoutMs / 1000} s`);
        if (signal?.aborted === true) throw error;
        throw new Error(`fetch: ${url.host}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

export default toolComponent(createFetchTool(), { replay: "never" });

/** `text` as a URL, when it is http(s). */
function httpUrl(text: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`fetch: "${text}" is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`fetch: only http:// and https:// URLs, not ${url.protocol}`);
  return url;
}

/** Sends the request and describes what came back, as text. */
async function request(url: URL, init: RequestInit, method: string, maxBytes: number, raw: boolean): Promise<string> {
  const response = await fetch(url, init);
  const type = response.headers.get("content-type") ?? "";
  const head = `HTTP ${response.status} ${response.statusText} · ${type || "no content-type"} · ${response.url || url.href}`;

  if (method === "HEAD") {
    return `${head}\n\n${[...response.headers].map(([name, value]) => `${name}: ${value}`).join("\n")}`;
  }
  let kind = kindOf(type);
  if (kind === "binary") {
    // Refused before reading: the body is never downloaded.
    await response.body?.cancel();
    const length = response.headers.get("content-length");
    return `${head}\n\n(binary content${length === null ? "" : `, ${length} bytes`}: not shown; fetch returns text only)`;
  }

  const { bytes, truncated } = await readAtMost(response.body, maxBytes);
  if (kind === "unknown") kind = bytes.subarray(0, 1024).includes(0) ? "binary" : "text";
  if (kind === "binary") return `${head}\n\n(binary content, ${bytes.length} bytes: not shown; fetch returns text only)`;
  const note = truncated ? `\n(only the first ${formatBytes(maxBytes)} were read)` : "";

  if (kind === "html" && !raw) return `${head}${note}\n\n${await htmlToText(bytes, type, response.url || url.href)}`;
  const text = decode(bytes, type);
  if (kind === "json") {
    try {
      return `${head}${note}\n\n${JSON.stringify(JSON.parse(text), null, 2)}`;
    } catch {
      // Not JSON after all (or cut at the limit): as it is.
    }
  }
  return `${head}${note}\n\n${text}`;
}

/** What a content type holds, as far as the model is concerned. */
function kindOf(contentType: string): "html" | "json" | "text" | "binary" | "unknown" {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "") return "unknown";
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type.endsWith("json")) return "json";
  if (type.startsWith("text/") || type.endsWith("xml") || /^application\/(javascript|ecmascript|x-www-form-urlencoded|yaml|x-yaml|toml)$/.test(type)) {
    return "text";
  }
  return "binary";
}

/** The body's first `max` bytes; the rest is cancelled, never downloaded. */
async function readAtMost(body: ReadableStream<Uint8Array> | null, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (body === null) return { bytes: new Uint8Array(), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > max) {
      chunks.push(value.subarray(0, max - size));
      size = max;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

/** Text in the content type's charset when the runtime knows it, UTF-8 otherwise. */
function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    // Bun types the label as a closed list; the runtime takes any label and throws on one it does not know.
    return new TextDecoder((charset ?? "utf-8") as "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/**
 * An HTML page as readable text: its title, its text by blocks (without head, scripts, styles), and
 * its links, absolute and unique, with their text. `HTMLRewriter` is a streaming parser that Workers
 * and Bun both provide; it reads the page's charset from `contentType`.
 */
async function htmlToText(bytes: Uint8Array, contentType: string, base: string): Promise<string> {
  let title = "";
  let hidden = 0;
  const parts: string[] = [];
  const links = new Map<string, { text: string }>();
  let link: { text: string } | undefined;
  const rewriter = new HTMLRewriter()
    .on("title", { text: (chunk) => void (title += chunk.text) })
    .on("head, script, style, noscript, svg, template, iframe", {
      element(element) {
        hidden++;
        element.onEndTag(() => void hidden--);
      },
    })
    .on("p, div, section, article, header, footer, main, nav, li, tr, br, hr, h1, h2, h3, h4, h5, h6, pre, blockquote, table, ul, ol", {
      element: () => void parts.push("\n"),
    })
    .on("td, th", { element: () => void parts.push(" ") })
    .on("a[href]", {
      element(element) {
        const href = element.getAttribute("href") ?? "";
        link = undefined;
        if (href.startsWith("#") || /^javascript:/i.test(href) || links.size >= MAX_LINKS) return;
        let absolute: string;
        try {
          absolute = new URL(decodeEntities(href), base).href;
        } catch {
          return;
        }
        link = links.get(absolute) ?? { text: "" };
        links.set(absolute, link);
        element.onEndTag(() => void (link = undefined));
      },
      text(chunk) {
        if (link !== undefined && hidden === 0) link.text += chunk.text;
      },
    })
    .onDocument({ text: (chunk) => void (hidden === 0 && parts.push(chunk.text)) });
  await rewriter.transform(new Response(bytes, { headers: { "content-type": contentType } })).arrayBuffer();

  const text = decodeEntities(parts.join(""))
    .replace(/[ \t\r\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const heading = decodeEntities(title).trim();
  const list = [...links].map(([href, { text: label }]) => {
    const name = decodeEntities(label).replace(/\s+/g, " ").trim();
    return `- ${name === "" ? href : `${name}: ${href}`}`;
  });
  return `${heading === "" ? "" : `# ${heading}\n\n`}${text}${list.length === 0 ? "" : `\n\nLinks:\n${list.join("\n")}`}`;
}

/** HTML's character references (`&amp;`, `&#39;`, `&#x2014;`): the parser hands text over undecoded. */
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

/** At most `MAX_OUTPUT` characters for the model, saying how many more there were. */
function clip(text: string): string {
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n\n(… ${text.length - MAX_OUTPUT} more characters not shown)`;
}

function formatBytes(bytes: number): string {
  return bytes % (1024 * 1024) === 0 ? `${bytes / (1024 * 1024)} MB` : `${bytes} bytes`;
}
