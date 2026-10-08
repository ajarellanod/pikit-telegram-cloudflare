import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/* ---------------------------------------------------------
 * PROMPT BAR
 * Beautiful UI's hero composer, with real controls: the "+"
 * menu (add images, web search for the next message), the
 * "/" menu (the commands the App registered, filtered as you
 * type; none: a quiet "No commands", and the text is sent as
 * a message), and a picker where the harness picks its
 * model, a dropdown even with one option. While a run goes
 * the send button stops it. Enter sends (or runs "/name
 * args" when it names a command), Shift+Enter breaks a line;
 * in a menu, arrows move, Enter picks (a command whose whole
 * name is typed runs), Tab completes, Escape closes. A message
 * sent leaves the composer at once (it comes back if sending
 * fails). `compact`: a line to write in, for a thread's foot.
 * --------------------------------------------------------- */

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const GLYPHS = {
  image: (
    <g>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </g>
  ),
  globe: (
    <g>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </g>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
};

export type PickerOption = { key: string; name: string; tag?: string };

export type Picker = {
  /** what it chooses, for its label: "assistant" */
  label: string;
  options: PickerOption[];
  value: string | undefined;
  /** absent: the value is shown, not chosen */
  onChange?: (key: string) => void;
  /** a line under the options: what choosing does */
  note?: string;
};

/** The images the composer takes: their types, how many, how large each (and in all), in bytes. */
export type ImageLimits = { types: readonly string[]; count: number; bytes: number; totalBytes?: number };

/** An image to send: its bytes in base64, without a `data:` prefix. */
export type ComposerImage = { name: string; mimeType: string; data: string };

/** What is sent: the text, the images, and whether the next message asks for a web search. */
export type ComposerMessage = { text: string; images: ComposerImage[]; webSearch: boolean };

/** A "/" command, as the App registered it (`GET /admin/api/commands`). */
export type Command = {
  /** without its slash: "new" */
  name: string;
  description: string;
  /** what it takes after its name: "<title>"; absent, it runs as soon as it is picked */
  argumentHint?: string;
};

/** "/name args": a command's name and what follows it, when the draft is one. */
const COMMAND_LINE = /^\/([a-z0-9][a-z0-9:-]*)(?:\s+([\s\S]*))?$/;

type Attached = { id: number; file: File; url: string };

type MenuRow = { key: string; name: string; hint?: string; desc: string; icon?: ReactNode; trailing?: ReactNode; disabled?: boolean; pick: () => void };

const megabytes = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

/** A file's bytes in base64. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(reader.error ?? new Error(`${file.name} could not be read`));
    reader.readAsDataURL(file);
  });
}

let nextId = 0;

export default function PromptBar({
  placeholder,
  picker,
  onSend,
  busy = false,
  onStop,
  disabled = false,
  autoFocus = false,
  compact = false,
  images,
  webSearch,
  commands = [],
  onCommand,
  commandsNote = "Type to search commands",
}: {
  placeholder?: string;
  picker?: Picker;
  /** sends the message; the draft is cleared at once, and back when it throws */
  onSend: (message: ComposerMessage) => Promise<void> | void;
  /** a run is going: with an empty draft, the send button stops it */
  busy?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** one line to write in instead of a roomy box: below a thread */
  compact?: boolean;
  /** "Add image" in the "+" menu; absent, the composer takes text only */
  images?: ImageLimits;
  /** "Web search" in the "+" menu: `available` when the assistant has the tool, else `unavailable` says why */
  webSearch?: { available: boolean; unavailable?: string };
  /** the "/" menu: the App's commands, by name */
  commands?: Command[];
  /** runs "/name args"; the draft is cleared once it resolves, kept when it throws */
  onCommand?: (name: string, args: string) => Promise<void> | void;
  /** the line under the commands */
  commandsNote?: string;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attached, setAttached] = useState<Attached[]>([]);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelBox, setModelBox] = useState<{ top: number; height: number } | null>(null);
  const [modelHovered, setModelHovered] = useState<number | null>(null);
  const [modelMenuLeft, setModelMenuLeft] = useState(0);
  const [modelMenuBottom, setModelMenuBottom] = useState(0);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const modelRowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const attachedRef = useRef(attached);
  attachedRef.current = attached;

  const options = picker?.options ?? [];
  const choosable = picker?.onChange !== undefined && options.length > 0;
  const chosen = options.find((option) => option.key === picker?.value);
  const canSearch = webSearch?.available === true;
  const webSearchOn = searching && canSearch;

  /* a "/" typed at the start opens the commands, filtered by what follows it */
  const slash = dismissed || plusOpen ? null : /^\/([\w:-]*)$/.exec(draft);
  const query = slash?.[1]?.toLowerCase() ?? "";
  const menu: "plus" | "slash" | null = plusOpen ? "plus" : slash !== null ? "slash" : null;

  const openPicker = () => {
    setPlusOpen(false);
    fileRef.current?.click();
  };
  const toggleSearch = () => {
    setPlusOpen(false);
    if (canSearch) setSearching((on) => !on);
    inputRef.current?.focus();
  };
  /* a command's draft: what the operator wrote names one of the App's commands */
  const commandOf = (text: string): { name: string; args: string } | undefined => {
    const line = COMMAND_LINE.exec(text.trim());
    const name = line?.[1];
    return name !== undefined && onCommand !== undefined && commands.some((command) => command.name === name) ? { name, args: (line?.[2] ?? "").trim() } : undefined;
  };

  const runCommand = async (name: string, args: string) => {
    if (onCommand === undefined) return;
    setSending(true);
    setPlusOpen(false);
    setModelOpen(false);
    try {
      await onCommand(name, args);
      setDraft("");
      setDismissed(false);
    } catch {
      // The caller says why; the draft stays.
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  /* picked from the menu: one that takes arguments waits for them, another runs at once */
  const pick = (command: Command) => {
    if (command.argumentHint !== undefined) {
      setDraft(`/${command.name} `);
      setDismissed(true);
      inputRef.current?.focus();
    } else void runCommand(command.name, "");
  };

  const rows: MenuRow[] =
    menu === "plus"
      ? [
          ...(images === undefined
            ? []
            : [
                {
                  key: "image",
                  name: "Add image",
                  desc: `${images.types.map((type) => type.replace("image/", "").toUpperCase()).join(", ")}, up to ${megabytes(images.bytes)}`,
                  icon: <Icon size={15}>{GLYPHS.image}</Icon>,
                  pick: openPicker,
                },
              ]),
          ...(webSearch === undefined
            ? []
            : [
                {
                  key: "search",
                  name: "Web search",
                  desc: canSearch ? (webSearchOn ? "On for the next message" : "Search the web for the next message") : (webSearch.unavailable ?? "Not available"),
                  icon: <Icon size={15}>{GLYPHS.globe}</Icon>,
                  trailing: webSearchOn ? (
                    <span className="shrink-0 text-ink">
                      <Icon size={13} strokeWidth={2.5}>
                        {GLYPHS.check}
                      </Icon>
                    </span>
                  ) : undefined,
                  disabled: !canSearch,
                  pick: toggleSearch,
                },
              ]),
        ]
      : menu === "slash"
        ? commands
            .filter((command) => command.name.startsWith(query))
            .map((command) => ({ key: command.name, name: `/${command.name}`, ...(command.argumentHint !== undefined && { hint: command.argumentHint }), desc: command.description, pick: () => pick(command) }))
        : [];

  useEffect(() => {
    setActive(0);
    setEngaged(false);
  }, [menu, query]);

  /* a single highlight glides to the active row instead of each row toggling its own background */
  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [menu, query, active, rows.length]);

  /* the same in the picker's menu: the hovered row, else the chosen one */
  const modelIndex = options.findIndex((option) => option.key === picker?.value);
  useLayoutEffect(() => {
    if (!modelOpen) return;
    const target = modelRowRefs.current[modelHovered ?? modelIndex];
    if (target) setModelBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [modelOpen, modelHovered, modelIndex]);

  /* the picker's menu sits outside the clipped composer: align it to the trigger by measurement */
  useLayoutEffect(() => {
    if (!modelOpen || !composerAnchorRef.current || !modelRef.current) return;
    const anchorRect = composerAnchorRef.current.getBoundingClientRect();
    const triggerRect = modelRef.current.getBoundingClientRect();
    setModelMenuLeft(Math.max(0, Math.min(triggerRect.left - anchorRect.left, anchorRect.width - 224)));
    setModelMenuBottom(anchorRect.bottom - triggerRect.top + 8);
  }, [modelOpen]);

  useEffect(() => {
    if (!modelOpen) setModelHovered(null);
  }, [modelOpen]);

  /* grow with the text, to a compact maximum */
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const maxHeight = 200;
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  /* clicking anywhere outside the composer, or Escape wherever the focus is, closes the menus */
  useEffect(() => {
    if (!modelOpen && !plusOpen) return;
    const closeAll = () => {
      setModelOpen(false);
      setPlusOpen(false);
    };
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-promptbar]")) closeAll();
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && closeAll();
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [modelOpen, plusOpen]);

  /* what the composer refused goes away after a while */
  useEffect(() => {
    if (problem === undefined) return;
    const timer = setTimeout(() => setProblem(undefined), 6000);
    return () => clearTimeout(timer);
  }, [problem]);

  /* the thumbnails' object URLs are released with the composer */
  useEffect(() => () => attachedRef.current.forEach((each) => URL.revokeObjectURL(each.url)), []);

  const attach = (files: File[]) => {
    if (images === undefined || files.length === 0) return;
    const taken: Attached[] = [];
    let total = attached.reduce((sum, each) => sum + each.file.size, 0);
    let refused: string | undefined;
    for (const file of files) {
      if (attached.length + taken.length >= images.count) refused ??= `At most ${images.count} images a message`;
      else if (!images.types.includes(file.type)) refused ??= `${file.name}: not a ${images.types.map((type) => type.replace("image/", "").toUpperCase()).join(", ")} image`;
      else if (file.size > images.bytes) refused ??= `${file.name}: larger than ${megabytes(images.bytes)}`;
      else if (images.totalBytes !== undefined && total + file.size > images.totalBytes) refused ??= `The images of a message are at most ${megabytes(images.totalBytes)} in all here`;
      else {
        total += file.size;
        taken.push({ id: nextId++, file, url: URL.createObjectURL(file) });
      }
    }
    setProblem(refused);
    if (taken.length > 0) setAttached((current) => [...current, ...taken]);
    inputRef.current?.focus();
  };

  const detach = (id: number) => {
    setAttached((current) => {
      const gone = current.find((each) => each.id === id);
      if (gone !== undefined) URL.revokeObjectURL(gone.url);
      return current.filter((each) => each.id !== id);
    });
    inputRef.current?.focus();
  };

  const canSend = (draft.trim().length > 0 || attached.length > 0) && !sending && !disabled;
  const stopping = busy && onStop !== undefined && draft.trim().length === 0 && attached.length === 0;

  const send = async () => {
    if (!canSend) return;
    const command = attached.length === 0 ? commandOf(draft) : undefined;
    if (command !== undefined) return runCommand(command.name, command.args);
    setSending(true);
    setModelOpen(false);
    setPlusOpen(false);
    // The message leaves the composer now; it comes back if sending fails.
    const text = draft;
    const files = attached;
    const search = webSearchOn;
    setDraft("");
    setAttached([]);
    setSearching(false);
    setProblem(undefined);
    try {
      const read = await Promise.all(files.map(async ({ file }) => ({ name: file.name, mimeType: file.type, data: await base64Of(file) })));
      await onSend({ text: text.trim(), images: read, webSearch: search });
      files.forEach((each) => URL.revokeObjectURL(each.url));
    } catch {
      // The caller says why; the draft comes back, unless another was begun since.
      setDraft((current) => (current === "" ? text : current));
      setAttached((current) => [...files, ...current]);
      setSearching(search);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div data-promptbar className="w-full">
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept={images?.types.join(",")}
        onChange={(event) => {
          attach([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <div ref={composerAnchorRef} className="relative">
        {/* -- "+" and "/" menu -- */}
        {menu !== null && (
          <div
            role="listbox"
            aria-label={menu === "plus" ? "Add to the message" : "Commands"}
            onMouseLeave={() => setEngaged(false)}
            className="absolute inset-x-0 bottom-full z-10 mb-2 rounded-[10px] bg-surface p-1 shadow-raised"
            style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
          >
            {/* single gliding highlight: appears once a row is hovered or reached with the keys */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{
                top: rowBox?.top ?? 0,
                height: rowBox?.height ?? 0,
                opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
                transition: "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
              }}
            />
            {rows.map((row, i) => (
              <button
                key={row.key}
                type="button"
                role="option"
                aria-selected={engaged && i === active}
                disabled={row.disabled}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  setActive(i);
                  setEngaged(true);
                }}
                onClick={() => row.pick()}
                className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left disabled:cursor-default"
              >
                {row.icon !== undefined && <span className={`flex size-5.5 shrink-0 items-center justify-center ${row.disabled ? "text-ink-3" : "text-ink-2"}`}>{row.icon}</span>}
                <span className={`shrink-0 text-[12.5px] font-medium ${row.disabled ? "text-ink-3" : "text-ink"}`}>{row.name}</span>
                {row.hint !== undefined && <span className="shrink-0 font-mono text-[11.5px] text-ink-3">{row.hint}</span>}
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{row.desc}</span>
                {row.trailing}
              </button>
            ))}
            {rows.length === 0 && (
              <div className="flex h-9 items-center px-2 text-[12px] text-ink-3">{menu === "slash" && commands.length === 0 ? "No commands" : `No command “/${query}”`}</div>
            )}
            {menu === "slash" && rows.length > 0 && <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">{commandsNote}</div>}
          </div>
        )}

        {/* -- picker menu -- */}
        {modelOpen && (
          <div
            role="listbox"
            aria-label={`Choose the ${picker?.label ?? "option"}`}
            onMouseLeave={() => setModelHovered(null)}
            className="absolute z-10 w-56 rounded-[10px] bg-surface p-1 shadow-raised"
            style={{ left: modelMenuLeft, bottom: modelMenuBottom, animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom left" }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{
                top: modelBox?.top ?? 0,
                height: modelBox?.height ?? 0,
                opacity: modelBox && modelHovered !== null ? 1 : 0,
                transition: "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
              }}
            />
            {options.map((option, i) => (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={option.key === picker?.value}
                ref={(el) => {
                  modelRowRefs.current[i] = el;
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setModelHovered(i)}
                onClick={() => {
                  setModelOpen(false);
                  inputRef.current?.focus();
                  if (option.key !== picker?.value) picker?.onChange?.(option.key);
                }}
                className="relative z-10 flex h-7.5 w-full items-center gap-2 rounded-[6px] px-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{option.name}</span>
                {option.tag !== undefined && <span className="shrink-0 text-[11px] text-ink-3">{option.tag}</span>}
                <span className={`shrink-0 text-ink ${option.key === picker?.value ? "" : "invisible"}`}>
                  <Icon size={13} strokeWidth={2.5}>
                    {GLYPHS.check}
                  </Icon>
                </span>
              </button>
            ))}
            {picker?.note !== undefined && <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] leading-4 text-ink-3">{picker.note}</div>}
          </div>
        )}

        {/* -- composer -- */}
        <div
          className={`relative isolate flex flex-col overflow-hidden border border-line bg-surface shadow-card transition-[border-color,border-radius] duration-150 focus-within:border-line-strong ${compact ? "gap-1.5 rounded-[18px] px-3 pt-2 pb-2.5" : "gap-2.5 rounded-[22px] p-3.5"}`}
        >
          {attached.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pt-0.5">
              {attached.map((each) => (
                <span key={each.id} className="relative" title={each.file.name} style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}>
                  <img src={each.url} alt={each.file.name} className="size-14 rounded-[10px] object-cover shadow-hairline" />
                  <button
                    type="button"
                    aria-label={`Remove ${each.file.name}`}
                    onClick={() => detach(each.id)}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-surface text-ink-2 shadow-btn transition-colors duration-100 hover:text-ink"
                  >
                    <Icon size={10} strokeWidth={2.5}>
                      {GLYPHS.close}
                    </Icon>
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-[28px_auto_minmax(0,1fr)_28px] items-end gap-x-1 gap-y-1.5">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              autoFocus={autoFocus}
              disabled={disabled}
              onChange={(event) => {
                setDraft(event.target.value);
                setDismissed(false);
                setPlusOpen(false);
                setModelOpen(false);
              }}
              onPaste={(event) => {
                const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
                if (files.length === 0 || images === undefined) return;
                event.preventDefault();
                attach(files);
              }}
              onKeyDown={(event) => {
                if (menu !== null && rows.length > 0) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setEngaged(true);
                    setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
                    return;
                  }
                  if ((event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === "Tab") {
                    event.preventDefault();
                    const row = rows[active];
                    if (row === undefined || row.disabled === true) return;
                    const command = menu === "slash" ? commands.find((each) => each.name === row.key) : undefined;
                    // Tab completes a command; Enter on its whole name runs it (its arguments are optional then).
                    if (command !== undefined && event.key === "Tab") setDraft(`/${command.name} `);
                    else if (command !== undefined && query === command.name) void runCommand(command.name, "");
                    else row.pick();
                    return;
                  }
                }
                if (event.key === "Escape") {
                  setDismissed(true);
                  setPlusOpen(false);
                  setModelOpen(false);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={placeholder ?? "Write a message…"}
              aria-label="Message"
              className={`col-span-full col-start-1 row-start-1 ${compact ? "min-h-9" : "min-h-[68px]"} w-full min-w-0 resize-none bg-transparent px-2 py-2 text-[14px] leading-5 text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3 disabled:opacity-60`}
            />

            {/* "+": images, web search */}
            {images !== undefined || webSearch !== undefined ? (
              <button
                type="button"
                aria-label="Add images or web search"
                aria-expanded={plusOpen}
                disabled={disabled}
                onClick={() => {
                  setModelOpen(false);
                  setPlusOpen((current) => !current);
                  inputRef.current?.focus();
                }}
                className={`col-start-1 row-start-2 flex size-7 shrink-0 items-center justify-center justify-self-start rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 enabled:hover:bg-hover enabled:hover:text-ink enabled:active:scale-[0.94] disabled:opacity-50 ${plusOpen ? "bg-hover text-ink" : ""}`}
              >
                <Icon size={16} strokeWidth={2}>
                  <path d="M12 5v14M5 12h14" />
                </Icon>
              </button>
            ) : (
              <span className="col-start-1 row-start-2" />
            )}

            {/* picker */}
            {picker !== undefined ? (
              <button
                ref={modelRef}
                type="button"
                aria-expanded={choosable ? modelOpen : undefined}
                aria-label={choosable ? `Choose the ${picker.label}` : `The ${picker.label}`}
                disabled={!choosable}
                onClick={() => {
                  setPlusOpen(false);
                  setModelOpen((current) => !current);
                }}
                className="col-start-2 row-start-2 flex h-7 shrink-0 items-center gap-1 justify-self-start rounded-[8px] px-1.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 enabled:hover:bg-hover enabled:hover:text-ink"
              >
                {chosen?.name ?? picker.value ?? `No ${picker.label}`}
                {choosable && (
                  <span className="text-ink-3">
                    <Icon size={11} strokeWidth={2.4}>
                      <path d="M6 9l6 6 6-6" />
                    </Icon>
                  </span>
                )}
              </button>
            ) : (
              <span className="col-start-2 row-start-2" />
            )}

            {/* web search on for the next message, or what was refused */}
            <div className="col-start-3 row-start-2 flex min-w-0 items-center gap-2 self-center pl-1">
              {webSearchOn && (
                <span className="flex h-6.5 shrink-0 items-center gap-1.5 rounded-chip bg-accent-tint py-1 pr-1 pl-1.5 text-[11.5px] font-medium text-accent-ink" style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}>
                  <Icon size={12}>{GLYPHS.globe}</Icon>
                  Web search
                  <button
                    type="button"
                    aria-label="Turn web search off"
                    onClick={() => setSearching(false)}
                    className="-my-1 flex size-5 items-center justify-center rounded-[5px] transition-colors duration-100 hover:bg-accent-tint"
                  >
                    <Icon size={10} strokeWidth={2.5}>
                      {GLYPHS.close}
                    </Icon>
                  </button>
                </span>
              )}
              {problem !== undefined && (
                <span role="status" className="min-w-0 truncate text-[12px] text-red" title={problem}>
                  {problem}
                </span>
              )}
            </div>

            {/* send, or stop while a run goes */}
            <button
              type="button"
              aria-label={stopping ? "Stop the run" : "Send"}
              title={stopping ? "Stop the run" : busy ? "Send: it runs after the run going" : "Send"}
              disabled={!stopping && !canSend}
              onClick={stopping ? onStop : () => void send()}
              className="col-start-4 row-start-2 flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94]"
              style={{
                background: canSend || stopping ? "var(--ink)" : "var(--line-strong)",
                color: canSend || stopping ? "var(--surface)" : "var(--ink-2)",
              }}
            >
              {stopping ? (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                  <rect width="10" height="10" rx="2" fill="currentColor" />
                </svg>
              ) : sending ? (
                <span className="size-3 rounded-full border-[1.5px] border-current border-t-transparent" style={{ animation: "spin 700ms linear infinite" }} />
              ) : (
                <Icon size={16} strokeWidth={2.4}>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </Icon>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
