/**
 * Comark (https://comark.dev), loaded on demand by `markdown.tsx`: it parses a model's markdown into a
 * document and renders that. CommonMark and GFM (tables, task lists, links found in the text), no
 * more: without Comark's default plugins raw HTML stays text, and so do its component and attribute
 * syntaxes (`:name{…}`, `{.class}`), which a model never means. Unfinished syntax (a `**` or a code
 * fence still being written) is closed while a message streams, so its layout holds. A code block
 * is the dashboard's CodeBlock: named by its file (```ts [src/app.ts]) or its language, with a copy
 * button; one in no language is not coloured.
 */

import { MarkdownDocument } from "@comark/react/components/MarkdownDocument";
import { parseMarkdown } from "comark";
import taskList from "comark/plugins/task-list";
import type { ComponentProps } from "react";
import CodeBlock from "@/components/bui/CodeBlock";

export type Parsed = Awaited<ReturnType<typeof parseMarkdown>>;

const plugins = [taskList()];

export const parse = (text: string): Promise<Parsed> => parseMarkdown(text, { registerDefaultPlugins: false, plugins });

/** A link leaves the dashboard for a tab of its own. */
function Link(props: ComponentProps<"a">) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

/** A node's text, all of it. */
const textOf = (node: unknown): string => (typeof node === "string" ? node : Array.isArray(node) ? node.slice(2).map(textOf).join("") : "");

/** A code block, from its node (`["pre", { language?, filename? }, ["code", {}, text]]`). */
function Code({ __node: node, language, filename }: { __node?: unknown; language?: string; filename?: string }) {
  const code = textOf(node).replace(/\n$/, "");
  return <CodeBlock code={code} filename={filename ?? language ?? "text"} meta={filename === undefined ? undefined : language} plain={language === undefined} />;
}
// Comark passes the node itself to a component that declares `__node` in its propTypes.
Code.propTypes = { __node: () => null };

const components = { a: Link, pre: Code };

export function Render({ document, className }: { document: Parsed; className?: string }) {
  return <MarkdownDocument value={document} components={components} className={className} />;
}
