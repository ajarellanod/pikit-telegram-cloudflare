/**
 * What the Context panel shows of a transcript (`context.tsx`), read from pi-ai's JSON as it comes
 * (`unknown`): the images sent in it (`imagesOf`), and its sources (`sourcesOf`): what the web search
 * tool (`websearch`) and the fetch tool (`fetch`) returned, a card each (`ContextCards`' chunks). The
 * tools' text is read as they write it today (tool-websearch-brave, tool-fetch), defensively: what
 * does not parse is left out, never shown wrong. No imports: the kit's tests run it as it is.
 */

export interface SentImage {
  key: string;
  mimeType: string;
  data: string;
  /** Epoch ms of its message. */
  at?: number;
}

/** A source, as `ContextCards` shows it (its `ContextChunk`). */
export interface Source {
  key: string;
  title: string;
  meta?: string;
  body: string;
  source: string;
  href?: string;
  badge: string;
  tone: string;
}

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields => (typeof value === "object" && value !== null ? (value as Fields) : {});
const parts = (content: unknown): Fields[] => (Array.isArray(content) ? content.map(fields) : []);

/** The images of the person's messages, oldest first. */
export function imagesOf(messages: readonly unknown[]): SentImage[] {
  return messages.flatMap((each, i) => {
    const message = fields(each);
    if (message.role !== "user") return [];
    const at = typeof message.timestamp === "number" ? { at: message.timestamp } : {};
    return parts(message.content).flatMap((part, j) =>
      part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string" ? [{ key: `${i}:${j}`, mimeType: part.mimeType, data: part.data, ...at }] : [],
    );
  });
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const isWeb = (url: unknown): url is string => typeof url === "string" && /^https?:\/\/\S+$/i.test(url);
const textOf = (content: unknown): string => parts(content).flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n");

/**
 * `websearch`'s results: blocks apart by a blank line, each `N. Title (age)`, then its address, then
 * its snippet, indented.
 */
function searchResults(text: string, key: string): Source[] {
  return text.split(/\n\s*\n/).flatMap((block, i) => {
    const match = /^\s*\d+\.\s+(.+)\n\s+(\S+)(?:\n\s+([\s\S]+))?$/.exec(block.trimEnd());
    const url = match?.[2];
    if (match === null || !isWeb(url)) return [];
    const host = hostOf(url);
    return [{ key: `${key}:${i}`, title: match[1]?.trim() || host, meta: `result ${i + 1}`, body: match[3]?.replace(/\s+/g, " ").trim() ?? "", source: host, href: url, badge: "WEB", tone: "bg-accent-blue" }];
  });
}

/**
 * `fetch`'s answer: `HTTP <status> <text> · <content type> · <final address>`, a blank line, then the
 * content (an HTML page as `# Title`, its text, then `Links:`).
 */
function fetched(text: string, key: string, asked: unknown): Source[] {
  const [head = "", ...rest] = text.split("\n");
  const columns = /^HTTP (\d{3})\b/.test(head) ? head.split(" · ") : [];
  const status = /^HTTP (\d{3})/.exec(columns[0] ?? "")?.[1];
  const url = [columns[2]?.trim(), asked].find(isWeb);
  if (status === undefined || url === undefined) return [];
  const type = (columns[1] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  let content = rest.join("\n").trim();
  let title: string | undefined;
  if (content.startsWith("# ")) {
    const end = content.indexOf("\n");
    title = (end === -1 ? content.slice(2) : content.slice(2, end)).trim();
    content = end === -1 ? "" : content.slice(end + 1).trim();
  }
  content = content.split(/\n\s*\nLinks:\n/)[0] ?? "";
  const host = hostOf(url);
  const badge = type.includes("html") ? "HTML" : type.includes("json") ? "JSON" : "TXT";
  return [
    {
      key,
      title: title || host,
      meta: status === "200" ? `${content.length.toLocaleString()} characters` : `HTTP ${status}`,
      body: content.replace(/\s+/g, " ").slice(0, 400),
      source: host,
      href: url,
      badge,
      tone: badge === "HTML" ? "bg-green" : badge === "JSON" ? "bg-orange" : "bg-accent-blue",
    },
  ];
}

/** The sources of `messages`: what each web search and fetch returned, oldest first. Failed calls are left out. */
export function sourcesOf(messages: readonly unknown[]): Source[] {
  const args = new Map<unknown, Fields>();
  for (const each of messages) {
    const message = fields(each);
    if (message.role !== "assistant") continue;
    for (const part of parts(message.content)) if (part.type === "toolCall") args.set(part.id, fields(part.arguments));
  }
  return messages.flatMap((each, i) => {
    const message = fields(each);
    if (message.role !== "toolResult" || message.isError === true) return [];
    const text = textOf(message.content);
    if (message.toolName === "websearch") return searchResults(text, `s${i}`);
    if (message.toolName === "fetch") return fetched(text, `f${i}`, args.get(message.toolCallId)?.url);
    return [];
  });
}
