/**
 * A model's text as markdown (models write it). The engine (`markdown-engine.tsx`, Comark) is a chunk
 * of its own, loaded with this module, apart from the dashboard's own; until it and the text's parse are there, the text
 * shows as it is. While a message streams each new text is parsed again and the last parse shown, so
 * the newest words never wait on an animation. Parsed texts are kept, so a message shown again (a
 * page read again, a tab back) is rendered at once.
 */

import { useEffect, useRef, useState } from "react";
import type { Parsed } from "@/components/pikit/markdown-engine";

type Engine = typeof import("@/components/pikit/markdown-engine");

let engine: Engine | undefined;
let loading: Promise<Engine> | undefined;
const load = () => (loading ??= import("@/components/pikit/markdown-engine").then((loaded) => (engine = loaded)));
// Asked for as soon as a view that shows messages loads, not when the first one shows.
void load().catch(() => {});

/** Parses kept, by text: the most recent last. */
const KEPT = 200;
const parsed = new Map<string, Parsed>();
function keep(text: string, document: Parsed) {
  parsed.delete(text);
  parsed.set(text, document);
  if (parsed.size > KEPT) parsed.delete(parsed.keys().next().value as string);
}

export function Markdown({ text, streaming = false, className = "" }: { text: string; streaming?: boolean; className?: string }) {
  const [shown, setShown] = useState<{ text: string; document: Parsed } | undefined>(() => {
    const document = parsed.get(text);
    return document === undefined ? undefined : { text, document };
  });
  // Parses can end out of order: an older one never replaces a newer one.
  const latest = useRef(0);
  const applied = useRef(0);

  useEffect(() => {
    const known = parsed.get(text);
    if (known !== undefined) {
      applied.current = ++latest.current;
      setShown({ text, document: known });
      return;
    }
    const turn = ++latest.current;
    load()
      .then((loaded) => loaded.parse(text))
      .then((document) => {
        // A message still being written is not kept: only its last text will be read again.
        if (!streaming) keep(text, document);
        if (turn < applied.current) return;
        applied.current = turn;
        setShown({ text, document });
      })
      .catch(() => {
        // Shown as it is.
      });
  }, [text, streaming]);

  if (shown === undefined || engine === undefined) return <div className={`markdown whitespace-pre-wrap ${className}`}>{text}</div>;
  return <engine.Render document={shown.document} className={`markdown ${className}`} />;
}
