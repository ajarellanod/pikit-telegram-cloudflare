/* ---------------------------------------------------------
 * STREAM TEXT
 * Beautiful UI's streaming atom, fed by a live stream instead of a
 * timer: `text` is what arrived so far. While `streaming`, the
 * newest characters resolve out of a soft blur and the caret holds
 * solid; once settled the text stands alone. Inherits typography.
 * --------------------------------------------------------- */

export function StreamText({
  text,
  streaming,
  blurTail = 6,
  className,
}: {
  text: string;
  streaming: boolean;
  /** how many trailing characters carry the soft blur edge */
  blurTail?: number;
  className?: string;
}) {
  const split = streaming ? Math.max(0, text.length - blurTail) : text.length;
  return (
    <span className={className}>
      {text.slice(0, split)}
      {split < text.length && <span className="stream-tail">{text.slice(split)}</span>}
      {streaming && <span aria-hidden className="stream-caret is-streaming" />}
    </span>
  );
}
