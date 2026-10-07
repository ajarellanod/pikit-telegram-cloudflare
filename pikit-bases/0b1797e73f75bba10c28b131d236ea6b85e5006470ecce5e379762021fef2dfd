/**
 * The home: a new conversation of the dashboard's own. The operator picks one of the App's agents (in
 * the composer, where Beautiful UI picks a model; `?agent=<name>` chooses one, as a conversation's
 * composer does when another is picked there) and writes the first message, with images and a web
 * search when wanted: `POST /admin/api/conversations` makes `dashboard:<uuid>`, whose answers appear
 * only here, and no other channel can continue it. Below, the last conversations, to continue. The
 * "/" menu lists the App's commands, which run in a conversation: here, they say so.
 */

import { ChatBubble } from "iconoir-react";
import { type CSSProperties, useEffect, useState } from "react";
import PromptBar, { type ComposerMessage } from "@/components/bui/PromptBar";
import { ErrorNote } from "@/components/pikit/error-note";
import { type ApiStartResponse, post } from "@/lib/api";
import { agentsOf, defaultAgentOf, NEW_CHAT, useChats } from "@/lib/chats";
import { Link, navigate, pagePath } from "@/lib/router";
import { useShell } from "@/lib/shell";
import { assistantName, assistantOptions, attachmentsOf, imageLimits, webSearchOf } from "./composer";

/* -- the entrance (ms after mount): hello, question, composer, suggestions -- */
const HOME_REVEAL_TIMING = [170, 330, 400, 550];
const HOME_REVEAL = { offsetY: 23, blur: 17, duration: 800, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };
/** The conversations suggested: the most recently active. */
const SUGGESTED = 3;

function homeRevealStyle(visible: boolean): CSSProperties {
  return {
    opacity: visible ? 1 : 0,
    transform: visible ? "translate3d(0, 0, 0)" : `translate3d(0, ${HOME_REVEAL.offsetY}px, 0)`,
    filter: visible ? "blur(0px)" : `blur(${HOME_REVEAL.blur}px)`,
    transition: ["opacity", "transform", "filter"].map((property) => `${property} ${HOME_REVEAL.duration}ms ${HOME_REVEAL.easing}`).join(", "),
  };
}

export function HomePage() {
  const { app, agents: described, commands, operator } = useShell();
  const chats = useChats();
  const agents = agentsOf(app);
  const [agent, setAgent] = useState<string | undefined>(() => new URLSearchParams(window.location.search).get("agent") ?? undefined);
  const [error, setError] = useState<Error>();
  const [stage, setStage] = useState(0);
  const chosen = agent !== undefined && agents.includes(agent) ? agent : defaultAgentOf(app);
  const fallback = defaultAgentOf(app);
  const webSearch = webSearchOf(described, chosen);

  useEffect(() => {
    const timers = HOME_REVEAL_TIMING.map((at, i) => setTimeout(() => setStage(i + 1), at));
    return () => timers.forEach(clearTimeout);
  }, []);

  const start = async ({ text, images, webSearch: search }: ComposerMessage) => {
    if (chosen === undefined) return;
    setError(undefined);
    try {
      const started = await post<ApiStartResponse>("/conversations", { agent: chosen, text, ...(images.length > 0 && { attachments: attachmentsOf(images) }), ...(search && { webSearch: true }) });
      if (text !== "") chats.setFirstMessage(started.key, text);
      chats.reload();
      navigate(pagePath("/conversations", started.conversationId));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown : new Error(String(thrown)));
      throw thrown;
    }
  };

  // The last conversations, to continue: one per key (a reset's previous ones are not suggested).
  const recent = (chats.items ?? []).filter((conversation) => conversation.key !== undefined && conversation.current !== false).slice(0, SUGGESTED);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[720px] flex-col justify-center px-4 py-10 sm:px-8">
        <h1 className="text-[26px] font-normal tracking-[-0.02em] text-ink">
          <span className="home-reveal block text-ink-3" style={homeRevealStyle(stage >= 1)}>
            Hello{operator === undefined || operator === "operator" ? "" : ` ${operator}`}
          </span>
          <span className="home-reveal block" style={homeRevealStyle(stage >= 2)}>
            What can I help you with?
          </span>
        </h1>

        <div className="home-reveal relative mt-7" style={homeRevealStyle(stage >= 3)}>
          <PromptBar
            autoFocus
            placeholder={chosen === undefined ? "The App has no agent to talk to" : `Ask ${assistantName(chosen)} anything…`}
            disabled={chosen === undefined}
            picker={{
              label: "assistant",
              options: assistantOptions(agents, (name) => (name === fallback && agents.length > 1 ? "default" : undefined)),
              value: chosen,
              onChange: setAgent,
            }}
            images={imageLimits(app)}
            webSearch={webSearch}
            commands={commands ?? []}
            commandsNote="Commands run in a conversation: start one, then run them there"
            onCommand={(name) => {
              setError(new Error(`/${name} runs in a conversation: start one with a first message, then run it there.`));
              throw new Error("no conversation");
            }}
            onSend={start}
          />
          {error !== undefined && (
            <div className="mt-3">
              <ErrorNote error={error} title="Not started" />
            </div>
          )}
        </div>

        <div className="home-reveal mt-6 flex flex-col" style={homeRevealStyle(stage >= 4)}>
          {recent.map((conversation) => {
            const title = chats.titleOf(conversation);
            return (
              <Link
                key={conversation.conversationId}
                to={pagePath("/conversations", conversation.conversationId)}
                className="-mx-2 flex items-center gap-3 rounded-control px-2 py-2.5 text-left text-[14px] text-ink transition-colors duration-150 hover:bg-hover"
              >
                <span className="flex w-[15px] shrink-0 justify-center text-ink-3">
                  <ChatBubble width={15} height={15} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 truncate">Continue {title === NEW_CHAT ? `the chat with ${conversation.agent === undefined ? "the assistant" : assistantName(conversation.agent)}` : title}</span>
              </Link>
            );
          })}
          <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 pl-0.5 text-[13px] text-ink-3">
            <span className="flex items-center gap-2 py-1">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="19" cy="12" r="1.7" />
              </svg>
              Only you see this conversation and its answers
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
