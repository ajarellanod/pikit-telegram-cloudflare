/**
 * How this channel sends one piece of an answer (`ChannelTransport`, @pikit/contracts' outbound.ts):
 * what `outbound.queue` calls when it is installed, and what the delivery in `delivery.ts` sends
 * through when it is not. Copied from channel-telegram's `transport.ts` (components never import each
 * other, C6); only the error's prefix changed.
 *
 * - A piece is sent as Telegram HTML (Markdown converted), or as plain text when Telegram cannot
 *   parse the HTML.
 * - Telegram's `sendMessage` has no idempotency key, so the transport is not idempotent: a piece sent
 *   again as a possible duplicate starts with `↻ `, so the reader knows it may have seen it.
 * - Failures are classified for the queue: a 429 waits Telegram's `retry_after`; no answer (the
 *   network) and a 5xx are transient, and a timeout may have reached Telegram; any other refusal (the
 *   user blocked the bot, the chat is gone, a bad request) is permanent.
 */

import { type ChannelTransport, DeliveryError } from "@pikit/contracts";
import { type TelegramApi, TelegramError } from "./api.ts";
import { MAX_MESSAGE_LENGTH, splitMessage, toTelegramHtml } from "./format.ts";
import { chatIn } from "./account.ts";

/** What a piece sent again as a possible duplicate starts with. */
export const POSSIBLE_DUPLICATE_MARK = "↻ ";

/** A rate limit without a `retry_after`: wait this long. */
const DEFAULT_RETRY_AFTER_S = 30;

/** The transport of one bot: `instance` is its account's (`telegram`, `telegram:<name>`). */
export function createTelegramTransport(api: TelegramApi, instance: string): ChannelTransport {
  return {
    idempotent: false,
    split: (text) => splitMessage(text),
    async send(piece, signal) {
      const chatId = chatIn(instance, piece.conversationKey);
      if (chatId === undefined) throw new DeliveryError("permanent", `channel-telegram-webhook: "${piece.conversationKey}" is not a conversation of ${instance}`);
      const text = piece.possibleDuplicate ? `${POSSIBLE_DUPLICATE_MARK}${piece.text}` : piece.text;
      try {
        const sent = await sendHtmlOrPlain(api, chatId, text, signal);
        return { platformMessageId: String(sent.message_id) };
      } catch (error) {
        if (signal.aborted) throw error;
        throw classify(error);
      }
    },
  };
}

/** HTML when Telegram can parse it and it fits; the same words as plain text otherwise. */
async function sendHtmlOrPlain(api: TelegramApi, chatId: number, text: string, signal: AbortSignal): Promise<{ message_id: number }> {
  const html = toTelegramHtml(text);
  if (html.length <= MAX_MESSAGE_LENGTH) {
    try {
      return await api.sendMessage(chatId, html, { html: true }, signal);
    } catch (error) {
      // 400 "can't parse entities": Telegram refused the markup, not the message.
      if (!(error instanceof TelegramError && error.code === 400 && /parse/i.test(error.message))) throw error;
    }
  }
  return await api.sendMessage(chatId, text, {}, signal);
}

/** A failed `sendMessage` as the queue understands it. */
export function classify(error: unknown): DeliveryError {
  if (!(error instanceof TelegramError)) return new DeliveryError("transient", String(error), { cause: error });
  if (error.code === 429) {
    return new DeliveryError("rate_limited", error.message, { retryAfterMs: (error.retryAfter ?? DEFAULT_RETRY_AFTER_S) * 1_000, cause: error });
  }
  // No answer: a request that timed out may have reached Telegram; one that never connected did not.
  if (error.code === 0) return new DeliveryError("transient", error.message, { maybeSent: /timeout/i.test(error.message), cause: error });
  if (error.code >= 500) return new DeliveryError("transient", error.message, { cause: error });
  return new DeliveryError("permanent", error.message, { cause: error });
}
