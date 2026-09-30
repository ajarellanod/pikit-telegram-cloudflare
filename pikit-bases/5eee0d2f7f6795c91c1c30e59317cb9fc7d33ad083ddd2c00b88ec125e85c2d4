/**
 * tool-websearch-brave's step of `pikit configure`: the Brave Search API key, which is optional. The
 * CLI finds this file in an installed component and calls `configure(io)`; it knows nothing about
 * Brave.
 *
 * - A key already in `.env`, or exported, is kept (written to `.env`, which the app reads).
 * - In a terminal, without one: where to get it, then the key, asked without echo. Enter skips: the
 *   app starts without it, and each search fails saying the key is not set.
 * - Without a terminal it asks nothing, and nothing is missing.
 *
 * It never prints the key, and never calls Brave: a key Brave refuses fails the search that uses it,
 * with Brave's status.
 */

import { KEY_SECRET } from "./index.ts";

/** What `pikit configure` gives a component's step. Structural, so this file imports nothing from the CLI. */
export interface ConfigureIO {
  /** A person answers at a terminal. False in scripts and CI: ask nothing. */
  interactive: boolean;
  /** A variable from `.env`, or exported in the environment. */
  get(name: string): string | undefined;
  /** Write a variable to `.env` (mode 0600) now; nothing happens when `.env` already has that value. */
  set(name: string, value: string): void;
  /** Asks without echoing the answer. */
  askSecret(question: string): Promise<string>;
  say(line: string): void;
}

/** Sets the key when there is one; returns what is missing: never anything, the key is optional. */
export async function configure(io: ConfigureIO): Promise<string[]> {
  const given = io.get(KEY_SECRET)?.trim();
  if (given !== undefined && given !== "") {
    io.set(KEY_SECRET, given);
    io.say(`  ${KEY_SECRET}: set (web search)`);
    return [];
  }
  if (!io.interactive) return [];
  io.say("\nWeb search (optional): the websearch tool searches with Brave Search, which needs an API key.");
  io.say("  Get one at https://api-dashboard.search.brave.com (the free plan works), or press Enter to skip.");
  const key = (await io.askSecret(`${KEY_SECRET} (Enter skips): `)).trim();
  if (key === "") {
    io.say(`  Skipped: searches fail, saying so, until ${KEY_SECRET} is set (\`pikit configure\` again, or .env)`);
    return [];
  }
  io.set(KEY_SECRET, key);
  io.say(`✓ ${KEY_SECRET} set`);
  return [];
}
