/**
 * The conversations the sidebar and the tabs show: every one, the most recently active first (the
 * API's index: the first page read again every 10 s while the dashboard is active, 30 s on
 * Cloudflare, older pages on demand), the tabs the operator opened, what the commands answered, and
 * the messages sent from here that the conversation does not show yet (shown at once, where they go).
 *
 * A title names one conversation (a reset's new one has its own). It is the API's
 * (`ApiConversation.title`: a model's, made after its first run, or the operator's `/name`; until then
 * its first message, once a model was asked to title it); until there is one, its first message when
 * this page has it at hand (sent from the home, or read in the open conversation's transcript: never
 * looked for), else for another channel's key the id in it (`telegram:12345` is `12345`), and "New
 * chat" for one of the dashboard's own. A conversation with no key (no message reached it and no reset
 * pointed a key to it) has nothing to show or do: the list leaves it out. Tabs are kept in
 * `localStorage["pikit-tabs"]`.
 *
 * The operator puts a conversation away from its row (`hide`): archived (listed apart, `archived`,
 * read when opened) or deleted (never listed again). The list only: the runtime keeps it, and new
 * activity (a person writes again) lists it again by itself.
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { every, usePolling } from "./activity.ts";
import { cleanTitle, isDashboardKey } from "./admin-api.ts";
import { api, type ApiApp, type ApiConversation, type ApiPage, post } from "./api.ts";

const PAGE = 50;
const TABS = "pikit-tabs";
/** Tabs kept. */
const KEPT_TABS = 12;
/** The title of a dashboard conversation with no title and no first message at hand. */
export const NEW_CHAT = "New chat";

/** What a command answered in a conversation: a quiet note there, in this page only (no channel gets it). */
export interface CommandNote {
  id: number;
  /** The command, without its slash. */
  command: string;
  text: string;
  at: number;
}

let nextNote = 0;

/** A message sent from here, shown in its conversation until the transcript has it. */
export interface SentMessage {
  id: number;
  text: string;
  images: { mimeType: string; data: string }[];
  /** Messages of the same text the conversation showed when it was sent: one more is this one. */
  before: number;
  /** It waits for the run going (`admission: "queued"`). */
  queued: boolean;
  /** Epoch ms: when it was sent. */
  at: number;
}

let nextSent = 0;

export interface Tab {
  id: string;
  /** Its conversation's title when it was opened; the API's newer one wins. */
  title: string;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept: this page still has it.
  }
}

/** The App's agents: the keys of `agent.definition`. */
export const agentsOf = (app: ApiApp | undefined): string[] => Object.keys(app?.capabilities["agent.definition"]?.keys ?? {}).sort();

/** The agent the App answers with when none is named (router-basic's `defaultAgent`), if it is one of `agents`. */
export function defaultAgentOf(app: ApiApp | undefined): string | undefined {
  const agents = agentsOf(app);
  const named = (app?.config["router-basic"] as { defaultAgent?: unknown } | undefined)?.defaultAgent;
  return typeof named === "string" && agents.includes(named) ? named : agents[0];
}

export interface Chats {
  /** Undefined until the first page is read. */
  items: ApiConversation[] | undefined;
  error: Error | undefined;
  hasOlder: boolean;
  loadOlder(): Promise<void>;
  reload(): void;
  /** Its title: the API's, else the first message at hand, the id in its key, or `NEW_CHAT`. */
  titleOf(conversation: ApiConversation): string;
  /** A tab's title: its conversation's, as it is now. */
  tabTitle(tab: Tab): string;
  /** The first message written in conversation `id`, as this page knows it: the title until the API has one. */
  setFirstMessage(id: string, text: string): void;
  /** The notes the commands run in conversation `id` answered, oldest first. */
  notesOf(id: string): CommandNote[];
  /** A command's answer in conversation `id`. */
  addNote(id: string, command: string, text: string): void;
  /** The messages sent to conversation `id` it does not show yet, oldest first. */
  sentOf(id: string): SentMessage[];
  /** A message sent to conversation `id`; answers its id. */
  addSent(id: string, message: Omit<SentMessage, "id" | "queued" | "at">): number;
  /** What became of one: queued, or gone (refused, a duplicate, or in the transcript now). */
  updateSent(id: string, sent: number, change: "queued" | "gone"): void;
  /** Epoch ms of the last message sent to conversation `id` from this page, if one was. */
  lastSentAt(id: string): number | undefined;
  tabs: Tab[];
  /** Opens (or refreshes) the tab of `conversation`. */
  openTab(conversation: ApiConversation): void;
  /** Closes a tab; answers the tab to show instead when it was `active`. */
  closeTab(id: string): Tab | undefined;
  /** The conversation `from` was reset into `to`: its tab follows (to the new one's title). */
  replaced(from: string, to: string): void;
  /** The archived ones, the most recently active first; undefined until `loadArchived` read them. */
  archived: ApiConversation[] | undefined;
  loadArchived(): void;
  /** Archives, restores (`unarchive`) or deletes a conversation: from the list only. Its tab closes when it leaves the list. */
  hide(id: string, action: "archive" | "unarchive" | "delete"): Promise<void>;
}

const ChatsContext = createContext<Chats | undefined>(undefined);

export function useChats(): Chats {
  const chats = useContext(ChatsContext);
  if (chats === undefined) throw new Error("useChats: outside ChatsProvider");
  return chats;
}

export function ChatsProvider({ children }: { children: ReactNode }) {
  const [first, setFirst] = useState<ApiPage<ApiConversation>>();
  const [older, setOlder] = useState<ApiConversation[]>([]);
  const [next, setNext] = useState<string | null>();
  const [error, setError] = useState<Error>();
  const [firsts, setFirsts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, CommandNote[]>>({});
  const [tabs, setTabs] = useState<Tab[]>(() => load<Tab[]>(TABS, []).filter((tab) => typeof tab?.id === "string"));
  const [archived, setArchived] = useState<ApiConversation[]>();
  /** Put away by this page, with their activity then: left out of the pages read until newer activity lists one again. */
  const [gone, setGone] = useState<ReadonlyMap<string, number>>(new Map());

  const reload = useCallback(() => {
    api<ApiPage<ApiConversation>>(`/conversations?limit=${PAGE}`)
      .then((page) => (setFirst(page), setError(undefined)))
      .catch((thrown: unknown) => setError(thrown instanceof Error ? thrown : new Error(String(thrown))));
  }, []);
  useEffect(reload, [reload]);
  usePolling(reload, every(10_000));

  const cursor = next === undefined ? first?.next : (next ?? undefined);
  const loadOlder = useCallback(async () => {
    if (cursor === undefined) return;
    try {
      const page = await api<ApiPage<ApiConversation>>(`/conversations?limit=${PAGE}&cursor=${encodeURIComponent(cursor)}`);
      setOlder((items) => [...items, ...page.items]);
      setNext(page.next ?? null);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown : new Error(String(thrown)));
    }
  }, [cursor]);

  useEffect(() => save(TABS, tabs.slice(-KEPT_TABS)), [tabs]);

  // The API's titles, by conversation.
  const titled = useMemo(() => {
    const byId = new Map<string, string>();
    for (const each of [...(first?.items ?? []), ...older]) if (each.title !== undefined) byId.set(each.conversationId, each.title);
    return byId;
  }, [first, older]);

  const titleOf = useCallback(
    (conversation: ApiConversation): string => {
      const known = conversation.title ?? titled.get(conversation.conversationId) ?? firsts[conversation.conversationId];
      if (known !== undefined) return known;
      const key = conversation.key;
      if (key === undefined || isDashboardKey(key)) return NEW_CHAT;
      return key.slice(key.indexOf(":") + 1) || key;
    },
    [titled, firsts],
  );
  const tabTitle = useCallback((tab: Tab): string => titled.get(tab.id) ?? firsts[tab.id] ?? tab.title, [titled, firsts]);

  const setFirstMessage = useCallback((id: string, text: string) => {
    const title = cleanTitle(text);
    if (title === undefined) return;
    setFirsts((all) => (all[id] !== undefined ? all : { ...all, [id]: title }));
  }, []);

  const [sent, setSent] = useState<Record<string, SentMessage[]>>({});
  const sentOf = useCallback((id: string): SentMessage[] => sent[id] ?? [], [sent]);
  const [lastSent, setLastSent] = useState<Record<string, number>>({});
  const lastSentAt = useCallback((id: string): number | undefined => lastSent[id], [lastSent]);
  const addSent = useCallback((id: string, message: Omit<SentMessage, "id" | "queued" | "at">) => {
    const each = { ...message, id: nextSent++, queued: false, at: Date.now() };
    setSent((all) => ({ ...all, [id]: [...(all[id] ?? []), each] }));
    setLastSent((all) => ({ ...all, [id]: each.at }));
    return each.id;
  }, []);
  const updateSent = useCallback((id: string, which: number, change: "queued" | "gone") => {
    setSent((all) => {
      const list = all[id] ?? [];
      if (!list.some((each) => each.id === which)) return all;
      return { ...all, [id]: change === "gone" ? list.filter((each) => each.id !== which) : list.map((each) => (each.id === which ? { ...each, queued: true } : each)) };
    });
  }, []);

  const notesOf = useCallback((id: string): CommandNote[] => notes[id] ?? [], [notes]);
  const addNote = useCallback((id: string, command: string, text: string) => {
    setNotes((all) => ({ ...all, [id]: [...(all[id] ?? []), { id: nextNote++, command, text, at: Date.now() }] }));
  }, []);

  const openTab = useCallback(
    (conversation: ApiConversation) => {
      const tab: Tab = { id: conversation.conversationId, title: titleOf(conversation) };
      setTabs((all) => {
        const at = all.findIndex((each) => each.id === tab.id);
        if (at === -1) return [...all, tab].slice(-KEPT_TABS);
        const known = all[at];
        return known?.title === tab.title ? all : all.map((each, i) => (i === at ? tab : each));
      });
    },
    [titleOf],
  );

  const closeTab = useCallback(
    (id: string) => {
      const at = tabs.findIndex((tab) => tab.id === id);
      setTabs((all) => all.filter((tab) => tab.id !== id));
      return at === -1 ? undefined : (tabs[at + 1] ?? tabs[at - 1]);
    },
    [tabs],
  );

  const replaced = useCallback((from: string, to: string) => {
    setTabs((all) => all.map((tab) => (tab.id === from ? { ...tab, id: to } : tab)));
  }, []);

  // A conversation active again since the older pages were read is on the first page: shown once.
  // One with no key has nothing to show or do: left out; so is one this page just put away.
  const items = useMemo(() => {
    if (first === undefined) return undefined;
    const seen = new Set<string>();
    return [...first.items, ...older].filter((each) => each.key !== undefined && !gone.has(each.conversationId) && !seen.has(each.conversationId) && seen.add(each.conversationId));
  }, [first, older, gone]);

  const loadArchived = useCallback(() => {
    api<ApiPage<ApiConversation>>(`/conversations?archived=1&limit=${PAGE}`)
      .then((page) => setArchived(page.items.filter((each) => each.key !== undefined)))
      .catch((thrown: unknown) => setError(thrown instanceof Error ? thrown : new Error(String(thrown))));
  }, []);

  const hide = useCallback(
    async (id: string, action: "archive" | "unarchive" | "delete") => {
      await post(`/conversations/${encodeURIComponent(id)}/${action}`);
      if (action === "unarchive") setGone((all) => new Map([...all].filter(([each]) => each !== id)));
      else {
        const at = [...(first?.items ?? []), ...older].find((each) => each.conversationId === id)?.lastActivity ?? 0;
        setGone((all) => new Map([...all, [id, at]]));
        setTabs((all) => all.filter((tab) => tab.id !== id));
      }
      if (archived !== undefined || action !== "delete") loadArchived();
      reload();
    },
    [archived, first, older, loadArchived, reload],
  );

  // Active again since it was put away (a person wrote): the API lists it again, and so does this page.
  useEffect(() => {
    if (first === undefined || gone.size === 0) return;
    const back = first.items.filter((each) => (gone.get(each.conversationId) ?? Infinity) < (each.lastActivity ?? 0)).map((each) => each.conversationId);
    if (back.length > 0) setGone((all) => new Map([...all].filter(([id]) => !back.includes(id))));
  }, [first, gone]);

  const value: Chats = { items, error, hasOlder: cursor !== undefined, loadOlder, reload, titleOf, tabTitle, setFirstMessage, notesOf, addNote, sentOf, addSent, updateSent, lastSentAt, tabs, openTab, closeTab, replaced, archived, loadArchived, hide };
  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}
