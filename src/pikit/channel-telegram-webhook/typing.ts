/**
 * "typing…", in the object's half (SPEC C3, C4): the wakeup `channel-telegram-webhook.typing` shows
 * it in every chat whose conversation has a message waiting for its run (`agent.submissions`'
 * `pending`), every 4 seconds, for at most 10 minutes per message, and asks for itself again while
 * one waits. Nothing waits in memory: on Cloudflare nothing runs between events.
 */

import type { AppContext } from "@pikit/core";
import type { AgentSubmissions, Wakeups } from "@pikit/contracts";
import { type Bot, findBot, TELEGRAM_TIMEOUT_MS, within } from "./bot.ts";

/** The wakeup this channel registers for "typing…". */
export const TYPING = "channel-telegram-webhook.typing";
/**
 * How often "typing…" is renewed: Telegram shows it for about 5 seconds. Not 5: the next renewal is
 * asked for after the send returns, so its period is this plus the send's latency, and at 5 s every
 * renewal would come after the last one faded (the object-App test holds the gaps under 5 s).
 */
export const TYPING_EVERY_MS = 4_000;
/** A message whose run has not ended after this long stops showing "typing…". */
const TYPING_AT_MOST_MS = 10 * 60_000;

export interface Typing {
  /** A message arrived: show "typing…" now, and while it waits. */
  kick(ctx: AppContext): Promise<void>;
}

export function startTyping(bots: readonly Bot[], submissions: AgentSubmissions, wakeups: Wakeups): Typing {
  /** A kick came during a run: the run's own next request must not put it off. */
  let kicked = false;
  wakeups.handle(TYPING, async (ctx) => {
    kicked = false;
    const now = ctx.clock.now();
    let any = false;
    for (const pending of await submissions.pending(ctx)) {
      const found = findBot(bots, pending.conversation.key);
      if (found === undefined || now - pending.oldestAdmittedAt > TYPING_AT_MOST_MS) continue;
      any = true;
      await within(TELEGRAM_TIMEOUT_MS, ctx.abortSignal, (signal) => found.bot.api.sendChatAction(found.chatId, "typing", signal)).catch(() => {});
    }
    if (kicked) await wakeups.at(TYPING, ctx.clock.now(), ctx);
    else if (any) await wakeups.at(TYPING, ctx.clock.now() + TYPING_EVERY_MS, ctx);
  });
  return {
    async kick(ctx) {
      kicked = true;
      await wakeups.at(TYPING, ctx.clock.now(), ctx);
    },
  };
}
