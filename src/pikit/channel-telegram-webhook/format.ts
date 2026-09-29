/**
 * An agent's answer as Telegram shows it. Models write Markdown; Telegram shows `**bold**` as it is
 * unless the message uses one of its own formats. This converts the common subset (bold, italics,
 * strikethrough, inline code, code blocks, links, headings, bullets) to Telegram's HTML, escaping
 * everything else. When Telegram still refuses a message, `transport.ts` sends it as plain text, so
 * a formatting mistake costs looks, never an answer.
 *
 * Telegram also refuses messages longer than 4096 characters, so long answers are split first, at
 * paragraph, line or word boundaries, and a code block cut in two is closed and reopened.
 *
 * Copied from channel-telegram's `format.ts`: components never import each other (C6).
 */

/** Telegram's limit for one message. */
export const MAX_MESSAGE_LENGTH = 4096;
/** Source characters per piece: room for the HTML the conversion adds. */
export const PIECE_LENGTH = 3500;

const FENCE = "```";

/** `text` in pieces of at most `limit` characters, cut where a reader would cut. */
export function splitMessage(text: string, limit = PIECE_LENGTH): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = lastBreak(window, "\n\n") ?? lastBreak(window, "\n") ?? lastBreak(window, " ") ?? limit;
    let piece = rest.slice(0, cut).trimEnd();
    rest = rest.slice(cut).trimStart();
    // A cut inside a code block: close it here and open it again in the next piece.
    if (countOf(piece, FENCE) % 2 === 1) {
      piece += `\n${FENCE}`;
      rest = `${FENCE}\n${rest}`;
    }
    pieces.push(piece);
  }
  if (rest !== "") pieces.push(rest);
  return pieces;
}

/** Where to cut `window`, if a boundary lies in its second half (a cut earlier would waste space). */
function lastBreak(window: string, boundary: string): number | undefined {
  const at = window.lastIndexOf(boundary);
  return at > window.length / 2 ? at + boundary.length : undefined;
}

function countOf(text: string, token: string): number {
  return text.split(token).length - 1;
}

/** Markdown to Telegram's HTML (https://core.telegram.org/bots/api#html-style). */
export function toTelegramHtml(markdown: string): string {
  // Code first, out of reach of every other rule: its content is shown exactly as written.
  const code: string[] = [];
  const hold = (html: string): string => `\u{F8FF}${code.push(html) - 1}\u{F8FF}`;
  let text = markdown.replace(/```([\w+-]*)\n?([\s\S]*?)(?:```|$(?![\s\S]))/g, (_match, language: string, body: string) =>
    hold(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(body.replace(/\n$/, ""))}</code></pre>`),
  );
  text = text.replace(/`([^`\n]+)`/g, (_match, body: string) => hold(`<code>${escapeHtml(body)}</code>`));

  text = escapeHtml(text);
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`);
  text = text.replace(/^#{1,6}[ \t]+(.+)$/gm, "<b>$1</b>");
  text = text.replace(/^([ \t]*)[*-][ \t]+/gm, "$1• ");
  text = text.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(?=\S)([\s\S]*?\S)__/g, "<b>$1</b>");
  text = text.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<s>$1</s>");
  text = text.replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "<i>$1</i>");
  text = text.replace(/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, "<i>$1</i>");

  return text.replace(/\u{F8FF}(\d+)\u{F8FF}/gu, (_match, index: string) => code[Number(index)] ?? "");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
