import { expect, test } from "bun:test";
import { PIECE_LENGTH, splitMessage, toTelegramHtml } from "./format.ts";

test("Markdown becomes Telegram's HTML", () => {
  expect(toTelegramHtml("**bold**, *italic*, _also_, ~~gone~~ and `x < y`")).toBe(
    "<b>bold</b>, <i>italic</i>, <i>also</i>, <s>gone</s> and <code>x &lt; y</code>",
  );
  expect(toTelegramHtml("# Title\n- one\n* two")).toBe("<b>Title</b>\n• one\n• two");
  expect(toTelegramHtml("see [the docs](https://example.com/a?b=1&c=2)")).toBe('see <a href="https://example.com/a?b=1&amp;c=2">the docs</a>');
});

test("code blocks are shown exactly as written, escaped, with their language", () => {
  expect(toTelegramHtml("```ts\nconst a = b && c < d; // **not bold**\n```")).toBe(
    '<pre><code class="language-ts">const a = b &amp;&amp; c &lt; d; // **not bold**</code></pre>',
  );
  expect(toTelegramHtml("```\nunterminated <b>")).toBe("<pre><code>unterminated &lt;b&gt;</code></pre>");
});

test("what is not Markdown stays as it is, escaped", () => {
  expect(toTelegramHtml("2 * 3 * 4 = 24, snake_case_name, a <tag> & more")).toBe("2 * 3 * 4 = 24, snake_case_name, a &lt;tag&gt; &amp; more");
  expect(toTelegramHtml("[not a link](javascript:alert(1))")).toBe("[not a link](javascript:alert(1))");
});

test("a short answer is one piece", () => {
  expect(splitMessage("  hello  ")).toEqual(["hello"]);
});

test("a long answer is split at paragraphs, each piece within the limit", () => {
  const paragraph = "word ".repeat(150).trim();
  const text = Array.from({ length: 12 }, () => paragraph).join("\n\n");

  const pieces = splitMessage(text);

  expect(pieces.length).toBeGreaterThan(1);
  for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(PIECE_LENGTH);
  expect(pieces.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
});

test("a code block cut in two is closed and reopened", () => {
  const code = Array.from({ length: 400 }, (_, i) => `line ${i} of the code`).join("\n");

  const pieces = splitMessage(`\`\`\`\n${code}\n\`\`\``, 1000);

  expect(pieces.length).toBeGreaterThan(1);
  for (const piece of pieces) {
    expect(piece.startsWith("```")).toBe(true);
    expect(piece.endsWith("```")).toBe(true);
  }
});

test("text with no break at all is still split", () => {
  expect(splitMessage("x".repeat(2500), 1000).map((piece) => piece.length)).toEqual([1000, 1000, 500]);
});
