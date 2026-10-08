/**
 * The dashboard's shell, in Beautiful UI's harness layout: the operator signs in with the token once
 * (a session cookie, `lib/api.ts`), then a sidebar (the App's menu, New chat, Home, the views the
 * App's composition allows, every conversation), a main pane with the conversations opened as tabs
 * (and the New chat's while the home shows; each one closes), and a side panel a page may fill (a
 * conversation's Context). A page that loads with a session still open goes straight in.
 */

import { Archive, EditPencil, Home, LogOut, Settings, SoundHigh, SoundOff, Trash, Undo } from "iconoir-react";
import { useCallback, useEffect, useState } from "react";
import { LoaderGrid } from "@/components/bui/LoadingState";
import SidebarNav, { MenuRow, MenuSeparator, type SidebarChat, type SidebarItem } from "@/components/bui/SidebarNav";
import { Switch } from "@/components/bui/Switch";
import { ThemeToggle } from "@/components/bui/ThemeToggle";
import { ErrorNote } from "@/components/pikit/error-note";
import { Mark } from "@/components/pikit/mark";
import { SettingsDialog } from "@/components/pikit/settings-dialog";
import { SignIn } from "@/components/pikit/sign-in";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setTarget } from "@/lib/activity";
import { api, type ApiAgents, type ApiApp, type ApiCommands, type ApiConversation, ApiFailure, onUnauthorized, signOut, useApi } from "@/lib/api";
import { ChatsProvider, useChats } from "@/lib/chats";
import { BASE, match, navigate, pagePath, usePath } from "@/lib/router";
import { appName, ShellContext, usePageTitle } from "@/lib/shell";
import { setSounds, useSounds } from "@/lib/sounds";
import { visibleViews } from "@/lib/views";

const OPERATOR = "pikit-operator";
const CHAT = "/conversations";

function CloseTab({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close tab"
      onClick={onClose}
      className="-my-1 flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-3 transition-[background-color,color] duration-100 hover:bg-hover-2 hover:text-ink"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

/**
 * The tabs: the conversations opened, then New chat while the home shows. Each one closes: the active
 * one gives way to its neighbour, and closing the last one leaves a fresh home (`onNewChat`).
 */
function TabBar({ path, home, onActions, onNewChat }: { path: string; home: string; onActions: (element: HTMLDivElement | null) => void; onNewChat: () => void }) {
  const chats = useChats();
  const busy = new Map((chats.items ?? []).map((conversation) => [conversation.conversationId, conversation.busy]));
  const onHome = path === home;

  const close = (id: string, active: boolean) => {
    const next = chats.closeTab(id);
    if (!active) return;
    if (next === undefined) onNewChat();
    else navigate(pagePath(CHAT, next.id));
  };
  const closeHome = () => {
    const last = chats.tabs.at(-1);
    if (last === undefined) onNewChat();
    else navigate(pagePath(CHAT, last.id));
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {chats.tabs.map((tab) => {
          const active = path === pagePath(CHAT, tab.id);
          return (
            <div
              key={tab.id}
              /* fixed width: every close button sits in the same spot */
              className={`group/tab flex h-7 w-36 shrink-0 items-center gap-0.5 rounded-[7px] pr-0.5 pl-2.5 text-[12.5px] font-medium transition-colors duration-100 ${active ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"}`}
            >
              <button type="button" aria-pressed={active} onClick={() => navigate(pagePath(CHAT, tab.id))} title={chats.tabTitle(tab)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                {busy.get(tab.id) === true && <span aria-label="Running" className="size-2.5 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: "spin 700ms linear infinite" }} />}
                <span className="block truncate">{chats.tabTitle(tab)}</span>
              </button>
              <CloseTab onClose={() => close(tab.id, active)} />
            </div>
          );
        })}
        {onHome && (
          <div className="flex h-7 w-36 shrink-0 items-center gap-0.5 rounded-[7px] bg-hover-2 pr-0.5 pl-2.5 text-[12.5px] font-medium text-ink">
            <span aria-current="page" className="block min-w-0 flex-1 truncate">
              New chat
            </span>
            <CloseTab onClose={closeHome} />
          </div>
        )}
        <button
          type="button"
          aria-label="New chat"
          onClick={onNewChat}
          className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <div ref={onActions} className="flex shrink-0 items-center gap-1" />
    </div>
  );
}

function Shell({ app, operator, onSignOut }: { app: ApiApp; operator: string | undefined; onSignOut: () => void }) {
  const path = usePath();
  const chats = useChats();
  const sounds = useSounds();
  const views = visibleViews(app);
  const found = views.flatMap((view) => view.pages.map((page) => ({ view, page, params: match(page.path, path) }))).find((each) => each.params !== undefined);
  const chatView = views.find((view) => view.id === "conversations");
  const home = chatView?.pages[0]?.path ?? views[0]?.pages[0]?.path ?? "/";
  const agents = useApi<ApiAgents>("/agents");
  const commands = useApi<ApiCommands>("/commands");
  const [draft, setDraft] = useState(0);
  /** A fresh home (its draft empty), with `agent` chosen when given. */
  const newChat = useCallback(
    (agent?: string) => {
      setDraft((n) => n + 1);
      navigate(agent === undefined ? home : `${home}?agent=${encodeURIComponent(agent)}`);
    },
    [home],
  );
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [side, setSide] = useState<HTMLDivElement | null>(null);
  const [narrow] = useState(() => !window.matchMedia("(min-width: 1024px)").matches);
  const name = appName(app);

  useEffect(() => {
    if (found === undefined && (path === "/" || path === "")) navigate(home, { replace: true });
  }, [found, home, path]);

  // The tab's title: the conversation's (its AI title, as the sidebar names it), the view's, or New chat.
  const openId = found?.page.path === `${CHAT}/:id` ? found.params?.id : undefined;
  const openTab = openId === undefined ? undefined : chats.tabs.find((tab) => tab.id === openId);
  const openChat = openId === undefined ? undefined : (chats.items ?? []).find((conversation) => conversation.conversationId === openId);
  const pageTitle =
    openId !== undefined
      ? openTab !== undefined
        ? chats.tabTitle(openTab)
        : openChat !== undefined
          ? chats.titleOf(openChat)
          : "Chat"
      : found?.view.id === "conversations"
        ? "New chat"
        : found?.view.title;
  usePageTitle(pageTitle, name);

  const items: SidebarItem[] = [
    {
      key: "new",
      label: "New chat",
      icon: <EditPencil />,
      href: `${BASE}${home}`,
      onSelect: () => newChat(),
    },
    { key: "home", label: "Home", icon: <Home />, active: path === home, href: `${BASE}${home}`, onSelect: () => navigate(home) },
    ...views
      .filter((view) => view.id !== "conversations")
      .map((view): SidebarItem => {
        const Icon = view.icon;
        const to = view.pages[0]?.path ?? `/${view.id}`;
        return { key: view.id, label: view.title, icon: Icon === undefined ? null : <Icon />, active: found?.view.id === view.id, href: `${BASE}${to}`, onSelect: () => navigate(to) };
      }),
  ];

  /** The conversation the operator asked to delete: confirmed first. */
  const [deleting, setDeleting] = useState<{ id: string; title: string }>();
  const [hideError, setHideError] = useState<Error>();
  const put = (id: string, action: "archive" | "unarchive" | "delete") => {
    setHideError(undefined);
    const leaving = action !== "unarchive" && path === pagePath(CHAT, id);
    chats.hide(id, action).then(
      () => leaving && newChat(),
      (thrown: unknown) => setHideError(thrown instanceof Error ? thrown : new Error(String(thrown))),
    );
  };
  const rowOf = (conversation: ApiConversation, archived: boolean): SidebarChat => {
    const id = conversation.conversationId;
    const title = chats.titleOf(conversation);
    return {
      id,
      label: title,
      busy: conversation.busy,
      active: path === pagePath(CHAT, id),
      href: `${BASE}${pagePath(CHAT, id)}`,
      actions: [
        archived
          ? { key: "unarchive", label: "Restore", icon: <Undo />, onSelect: () => put(id, "unarchive") }
          : { key: "archive", label: "Archive", icon: <Archive />, onSelect: () => put(id, "archive") },
        { key: "delete", label: "Delete", icon: <Trash />, danger: true, onSelect: () => setDeleting({ id, title }) },
      ],
    };
  };
  const sidebarChats: SidebarChat[] = (chats.items ?? []).map((conversation) => rowOf(conversation, false));

  const Page = found?.page.component;
  const page =
    Page === undefined ? (
      <div className="p-8 text-[13.5px] text-ink-3">No page here.</div>
    ) : found?.page.fill === true ? (
      // One instance per conversation: nothing of one shows in another.
      <Page key={found.page.path === home ? `home-${draft}` : path} params={found.params ?? {}} />
    ) : (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
          <Page params={found?.params ?? {}} />
        </div>
      </div>
    );

  return (
    <ShellContext.Provider
      value={{ app, ...(agents.data !== undefined && { agents: agents.data.items }), reloadAgents: agents.reload, ...(commands.data !== undefined && { commands: commands.data.items }), newChat, views, operator, slots: { actions, side } }}
    >
      <main className="flex h-[100dvh] gap-0 bg-canvas p-2.5 pl-0 text-ink">
        <SidebarNav
          defaultCollapsed={narrow}
          workspace={{ name, logo: <Mark size={20} /> }}
          items={items}
          chats={sidebarChats}
          archived={{ chats: chats.archived?.map((conversation) => rowOf(conversation, true)), onOpen: chats.loadArchived }}
          chatsEmpty={chats.error !== undefined ? "The chats cannot be read" : chats.items === undefined ? "Loading" : "No chats yet"}
          onPickChat={(id) => navigate(pagePath(CHAT, id))}
          chatsFooter={
            chats.hasOlder ? (
              <button type="button" onClick={() => void chats.loadOlder()} className="sidebar-copy mx-2 px-2 py-2 text-left text-[12.5px] font-medium text-ink-3 transition-colors duration-100 hover:text-ink">
                Older chats
              </button>
            ) : undefined
          }
          menu={(close) => (
            <>
              <MenuRow
                icon={<Settings />}
                onClick={() => {
                  close();
                  setSettingsOpen(true);
                }}
              >
                Settings
              </MenuRow>
              <MenuSeparator />
              <div className="flex h-10 items-center gap-1.5 px-2">
                <span className="min-w-0 flex-1 text-[13.5px] text-ink">Theme</span>
                <ThemeToggle />
              </div>
              <MenuRow
                icon={sounds ? <SoundHigh /> : <SoundOff />}
                onClick={() => setSounds(!sounds)}
                trailing={
                  <span aria-hidden>
                    <Switch checked={sounds} size="sm" />
                  </span>
                }
              >
                Interaction sounds
              </MenuRow>
              <MenuSeparator />
              <MenuRow
                icon={<LogOut />}
                onClick={() => {
                  close();
                  onSignOut();
                }}
              >
                Sign out
              </MenuRow>
            </>
          )}
        />

        <SettingsDialog app={app} open={settingsOpen} onOpenChange={setSettingsOpen} />

        <AlertDialog open={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
              <AlertDialogDescription>
                “{deleting?.title}” leaves the list for good. If its person writes again, it comes back with the new message.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red text-white hover:bg-red/90"
                onClick={() => {
                  if (deleting !== undefined) put(deleting.id, "delete");
                  setDeleting(undefined);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex min-w-0 flex-1 gap-2.5">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-window border border-line bg-page">
            {hideError !== undefined && (
              <div className="border-b border-line px-3 py-2">
                <ErrorNote error={hideError} title="The chat could not be changed" />
              </div>
            )}
            <TabBar path={path} home={home} onActions={setActions} onNewChat={() => newChat()} />
            <div className="flex min-h-0 flex-1 flex-col">{page}</div>
          </section>
          <div ref={setSide} className="contents" />
        </div>
      </main>
    </ShellContext.Provider>
  );
}

type State = { kind: "checking" } | { kind: "signed-out"; refused: boolean } | { kind: "signed-in"; app: ApiApp } | { kind: "failed"; error: Error };

function storedOperator(): string | undefined {
  try {
    return localStorage.getItem(OPERATOR) ?? undefined;
  } catch {
    return undefined;
  }
}

export function App() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [operator, setOperator] = useState(storedOperator);

  // The composition: with a session still open the page goes straight in; a `401` asks for the token.
  const enter = useCallback((refused: boolean) => {
    api<ApiApp>("/app")
      .then((app) => {
        setTarget(app.target);
        setState({ kind: "signed-in", app });
      })
      .catch((error: unknown) =>
        setState(error instanceof ApiFailure && error.status === 401 ? { kind: "signed-out", refused } : { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) }),
      );
  }, []);

  useEffect(() => enter(false), [enter]);
  // A session that ends while in (it expired, or the token changed) asks again, saying so.
  useEffect(() => onUnauthorized(() => setState((current) => (current.kind === "signed-in" ? { kind: "signed-out", refused: true } : current))), []);

  const signedIn = (who: string | undefined) => {
    setOperator(who);
    try {
      if (who === undefined) localStorage.removeItem(OPERATOR);
      else localStorage.setItem(OPERATOR, who);
    } catch {
      // Not remembered: greeted without a name after a reload.
    }
    enter(false);
  };
  const leave = () => void signOut().then(() => setState({ kind: "signed-out", refused: false }));

  return (
    <TooltipProvider>
      {state.kind === "checking" && (
        <main className="flex min-h-svh items-center justify-center gap-2.5 bg-canvas text-[13px] text-ink-3">
          <LoaderGrid /> Loading
        </main>
      )}
      {state.kind === "failed" && (
        <main className="flex min-h-svh items-center justify-center bg-canvas p-6">
          <div className="w-full max-w-md">
            <ErrorNote error={state.error} title="The admin API cannot be read" />
          </div>
        </main>
      )}
      {state.kind === "signed-out" && <SignIn refused={state.refused} onSignedIn={signedIn} />}
      {state.kind === "signed-in" && (
        <ChatsProvider>
          <Shell app={state.app} operator={operator} onSignOut={leave} />
        </ChatsProvider>
      )}
    </TooltipProvider>
  );
}
