/**
 * The webhook's secret. A Worker's URL is public, so anyone could post a made-up update to it: the
 * secret is what proves a request comes from Telegram. `setWebhook` gives it to Telegram as
 * `secret_token`, and Telegram sends it back in `X-Telegram-Bot-Api-Secret-Token` with every update.
 *
 * It is compared as SHA-256 digests, byte by byte without stopping early, so the time a comparison
 * takes says nothing about how much of a guess was right, nor about the secret's length (the way
 * channel-http compares its token; Web Crypto only, so it runs on both targets).
 */

export const SECRET_HEADER = "x-telegram-bot-api-secret-token";
/** Telegram's rule for `secret_token`: 1 to 256 of `A-Z`, `a-z`, `0-9`, `_` and `-`. */
export const SECRET_SHAPE = /^[A-Za-z0-9_-]{1,256}$/;
/** Shorter secrets are refused: they can be guessed. `pikit configure` generates 64 characters. */
export const MIN_SECRET_LENGTH = 16;

export type Digest = Uint8Array;

/** What is wrong with `value` as a webhook secret, or `undefined` when it is a good one. */
export function secretProblem(value: string): string | undefined {
  if (!SECRET_SHAPE.test(value)) return "Telegram accepts only letters, digits, _ and -, at most 256 of them";
  if (value.length < MIN_SECRET_LENGTH) return `it is shorter than ${MIN_SECRET_LENGTH} characters`;
  return undefined;
}

/** Shorter passwords (`login.ts`) are refused: they could be guessed. */
export const PASSWORD_MIN_LENGTH = 8;

/** What is wrong with `value` as the bot's password, or `undefined` when it is a good one. */
export function passwordProblem(value: string): string | undefined {
  if (value.trim().length < PASSWORD_MIN_LENGTH) return `it is shorter than ${PASSWORD_MIN_LENGTH} characters, so it could be guessed`;
  return undefined;
}

/** A new secret: 32 random bytes, as 64 hexadecimal characters. */
export function generateSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digest(text: string): Promise<Digest> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Whether `presented` is the secret whose digest is `expected`, in time independent of both. */
export async function matches(presented: string | null, expected: Digest): Promise<boolean> {
  if (presented === null) return false;
  const actual = await digest(presented);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return difference === 0;
}
