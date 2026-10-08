/**
 * On Cloudflare the values are one object's, the settings object (`SETTINGS_KEY`, an object of the
 * conversations' class that is never a conversation, as admin-api's index is), reached by
 * `actor.mailbox.call` and answered with `actor.inbox.answer`:
 *
 * | Type | Message | Answer |
 * |---|---|---|
 * | `settings-store.read` | `{ version }`: the version the caller holds (`-1`: none) | `{ version }` when it is the current one, else `{ version, values }`: every stored value |
 * | `settings-store.sections` | — | `{ items: SettingsSection[] }`: the object's App's declarations, with their values |
 * | `settings-store.set` | `{ component, value, operator }` | `{ value }`: the value `get` now gives |
 *
 * A refusal is an `ActorCallError` whose code is the `SettingsError`'s (`unknown_component`,
 * `invalid_value`), or `invalid_request` for a malformed call; the caller turns it back.
 *
 * - **A conversation's object reads at most one call per admission** (`createRemoteSource`): it keeps
 *   the values with their version, and a `get` within `freshMs` of the last call (a second) is
 *   answered from them; past it, the call says whether the version changed, and carries the values
 *   only when it did. Concurrent reads share one call. When the call fails, the values it holds are
 *   used (logged); with none, `get` rejects and its caller keeps what it had.
 * - **The Worker** (`worker.ts`) only serves the routes: `sections` and `set` are calls, validated and
 *   logged in the settings object, against its App's declarations (the same as every object's).
 */

import type { AppContext, Clock } from "@pikit/core";
import {
  ActorCallError,
  type ActorInbox,
  type ActorMailbox,
  isJsonObject,
  type JsonValue,
  type Operator,
  type Settings,
  SettingsError,
  type SettingsSection,
  type SettingsValue,
} from "@pikit/contracts";
import type { SettingsSource } from "./settings.ts";
import type { SettingsTable } from "./table.ts";

/** The object that keeps the values on Cloudflare: an object of the conversations' class, never a conversation. */
export const SETTINGS_KEY = "settings-store:settings";

export const CALL = {
  read: "settings-store.read",
  sections: "settings-store.sections",
  set: "settings-store.set",
} as const;

/** How long an object answers `get` from the values it read last, before it asks again (one call per admission at most). */
export const FRESH_MS = 1_000;

type Fields = Record<string, unknown>;
const fieldsOf = (message: JsonValue): Fields => (isJsonObject(message) ? message : {});
const malformed = (what: string) => new ActorCallError("invalid_request", `settings-store: ${what}`);

/** A `SettingsError` as it crosses a call. */
function crossing(error: unknown): unknown {
  return error instanceof SettingsError ? new ActorCallError(error.code, error.message) : error;
}

/** A call's refusal as the `SettingsError` it was, or as it came. */
export function refusalOf(error: unknown): unknown {
  if (!(error instanceof ActorCallError)) return error;
  const code: string = error.code;
  return code === "unknown_component" || code === "invalid_value" ? new SettingsError(code, error.message) : error;
}

/**
 * Registers the settings object's answers, over its table and its App's settings over that table
 * (`local`). Every object registers them; only the settings object is called. Call it in `start`.
 */
export function answerCalls(inbox: ActorInbox, table: SettingsTable, local: Settings): void {
  inbox.answer(CALL.read, async (_key, message) => {
    const held = fieldsOf(message).version;
    if (typeof held !== "number" || !Number.isInteger(held)) throw malformed('"version" is an integer');
    const version = await table.version();
    if (version === held) return { version };
    return { ...(await table.snapshot()) } as unknown as JsonValue;
  });
  inbox.answer(CALL.sections, async (_key, _message, ctx) => ({ items: (await local.sections(ctx)) as unknown as JsonValue }));
  inbox.answer(CALL.set, async (_key, message, ctx) => {
    const { component, value, operator } = fieldsOf(message);
    if (typeof component !== "string" || component === "") throw malformed('"component" is a non-empty string');
    if (typeof operator !== "string" || operator === "") throw malformed('"operator" is a non-empty string');
    if (!isJsonObject(value)) throw new ActorCallError("invalid_value", "a component's settings are a JSON object");
    try {
      return { value: await local.set(component, value as SettingsValue, { id: operator }, ctx) };
    } catch (error) {
      throw crossing(error);
    }
  });
}

/**
 * A conversation object's source: the settings object's values, kept with their version and read
 * again at most every `freshMs`. Writing is the settings object's (`remoteSet`).
 */
export function createRemoteSource(mailbox: () => ActorMailbox | undefined, clock: Clock, freshMs = FRESH_MS): SettingsSource & { forget(): void } {
  let held: { version: number; values: Record<string, SettingsValue>; at: number } | undefined;
  let reading: Promise<Record<string, SettingsValue>> | undefined;

  const fetchValues = async (ctx: AppContext): Promise<Record<string, SettingsValue>> => {
    const calls = mailbox();
    if (calls === undefined) throw new Error("settings-store: in a Durable Object's App it reads the settings object, which needs actor.mailbox: install platform-cloudflare");
    try {
      const answer = fieldsOf(await calls.call(SETTINGS_KEY, CALL.read, { version: held?.version ?? -1 }, ctx));
      const { version, values } = answer;
      if (typeof version !== "number") throw new Error("settings-store: the settings object answered no version");
      if (values !== undefined || held === undefined) held = { version, values: (isJsonObject(values) ? values : {}) as Record<string, SettingsValue>, at: clock.now() };
      else held = { ...held, at: clock.now() };
      return held.values;
    } catch (error) {
      if (held === undefined) throw error;
      ctx.logger.warn("settings-store: the settings object could not be read; the values read last apply", { error: error instanceof Error ? error.message : String(error) });
      return held.values;
    }
  };

  return {
    async read(ctx) {
      if (held !== undefined && clock.now() - held.at < freshMs) return held.values;
      reading ??= fetchValues(ctx).finally(() => {
        reading = undefined;
      });
      return reading;
    },
    write() {
      throw new Error("settings-store: an object writes through the settings object (createRemoteAdmin)");
    },
    /** After this App's own set: its next `get` asks. */
    forget() {
      if (held !== undefined) held = { ...held, at: Number.NEGATIVE_INFINITY };
    },
  };
}

/** `set` and `sections` as calls to the settings object: the Worker's routes, an object's `set`. */
export function createRemoteAdmin(mailbox: () => ActorMailbox | undefined): Pick<Settings, "set" | "sections"> {
  const call = async (type: string, message: JsonValue, ctx: AppContext): Promise<Fields> => {
    const calls = mailbox();
    if (calls === undefined) throw new Error("settings-store: the settings object is reached through actor.mailbox: install platform-cloudflare");
    try {
      return fieldsOf(await calls.call(SETTINGS_KEY, type, message, ctx));
    } catch (error) {
      throw refusalOf(error);
    }
  };
  return {
    async set(component: string, value: SettingsValue, operator: Operator, ctx: AppContext) {
      return (await call(CALL.set, { component, value, operator: operator.id }, ctx)).value as SettingsValue;
    },
    async sections(ctx: AppContext) {
      return ((await call(CALL.sections, null, ctx)).items ?? []) as SettingsSection[];
    },
  };
}
