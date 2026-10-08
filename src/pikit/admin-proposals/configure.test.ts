/**
 * admin-proposals' step of `pikit configure`, with a scripted person at the terminal, a `.env` and a
 * config entry in memory: optional, asked only in a terminal and only when wanted, the repository from
 * the git remote by default, the tokens never shown and never the same.
 */

import { expect, test } from "bun:test";
import { type ConfigureIO, configure, githubRepositoryOf } from "./configure.ts";

const READ = "github_pat_read-token-for-tests";
const MERGE = "github_pat_merge-token-for-tests";

function terminal(options: { interactive?: boolean; env?: Record<string, string>; config?: Record<string, unknown>; answers?: (string | boolean)[] } = {}) {
  const env = new Map(Object.entries(options.env ?? {}));
  const config: Record<string, unknown> = { ...options.config };
  const answers = [...(options.answers ?? [])];
  const said: string[] = [];
  const asked: string[] = [];
  const next = (question: string) => {
    asked.push(question);
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`unexpected question: ${question}`);
    return answer;
  };
  const io: ConfigureIO = {
    interactive: options.interactive ?? true,
    config,
    get: (name) => env.get(name),
    set: (name, value) => void env.set(name, value),
    setConfig: (key, value) => void (config[key] = value),
    ask: async (question) => String(next(question)),
    askSecret: async (question) => String(next(question)),
    confirm: async (question) => next(question) === true,
    say: (line) => void said.push(line),
  };
  return { io, env, config, said, asked };
}

test("GitHub URLs give owner/name: https, ssh, git@", () => {
  for (const url of ["https://github.com/ana/bot", "https://github.com/ana/bot.git", "git@github.com:ana/bot.git", "ssh://git@github.com/ana/bot.git", "https://github.com/ana/bot/"]) {
    expect([url, githubRepositoryOf(url)]).toEqual([url, "ana/bot"]);
  }
  expect(githubRepositoryOf("https://gitlab.com/ana/bot")).toBeUndefined();
  expect(githubRepositoryOf("")).toBeUndefined();
});

test("without a terminal it asks nothing, writes nothing, and nothing is missing: it stays dormant", async () => {
  const t = terminal({ interactive: false });
  expect(await configure(t.io, () => "git@github.com:ana/bot.git")).toEqual([]);
  expect([t.asked, t.env.size, t.config]).toEqual([[], 0, {}]);
});

test("declined: nothing is written, and it says how to connect it later", async () => {
  const t = terminal({ answers: [false] });
  expect(await configure(t.io, () => undefined)).toEqual([]);
  expect(t.asked).toEqual(["Connect self-improvement now?"]);
  expect([t.env.size, t.config]).toEqual([0, {}]);
  expect(t.said.join("\n")).toContain("Settings → Self-improvement");
});

test("connected: the git remote's repository by default, written to the config; both tokens asked without echo, to .env; the ruleset explained", async () => {
  const t = terminal({ answers: [true, "", READ, MERGE] });
  expect(await configure(t.io, () => "git@github.com:ana/bot.git")).toEqual([]);
  expect(t.asked).toEqual(["Connect self-improvement now?", "The project's GitHub repository, owner/name (Enter: ana/bot): ", "GITHUB_TOKEN (Enter skips): ", "PIKIT_MERGE_TOKEN (Enter skips): "]);
  expect(t.config).toEqual({ repository: "ana/bot" });
  expect(Object.fromEntries(t.env)).toEqual({ GITHUB_TOKEN: READ, PIKIT_MERGE_TOKEN: MERGE });
  const said = t.said.join("\n");
  expect(said).toContain("https://github.com/settings/personal-access-tokens/new");
  expect(said).toContain("Contents and Pull requests read and write");
  expect(said).toContain("https://github.com/ana/bot/settings/rules");
  expect(said).not.toContain(READ);
  expect(said).not.toContain(MERGE);

  // Run again: it is connected, and nothing is asked.
  const again = terminal({ env: Object.fromEntries(t.env), config: t.config });
  expect(await configure(again.io)).toEqual([]);
  expect(again.asked).toEqual([]);
  expect(again.said).toEqual(["  Self-improvement: ana/bot, with GITHUB_TOKEN and PIKIT_MERGE_TOKEN set"]);
});

test("a repository that is not owner/name is asked again, a URL is taken; the merge token may not be the read token; a token set is kept", async () => {
  const t = terminal({ env: { GITHUB_TOKEN: READ }, config: { repository: "" }, answers: [true, "not a repository", "https://github.com/ana/other", READ, MERGE] });
  expect(await configure(t.io, () => undefined)).toEqual([]);
  expect(t.config.repository).toBe("ana/other");
  expect(t.asked.filter((question) => question.startsWith("GITHUB_TOKEN"))).toEqual([]);
  expect(t.said).toContain("  GITHUB_TOKEN: already set");
  expect(t.said).toContain("  That is GITHUB_TOKEN: merging needs a token of its own");
  expect(t.env.get("PIKIT_MERGE_TOKEN")).toBe(MERGE);
});

test("the config's repository and secret names are its defaults; Enter skips a token", async () => {
  const t = terminal({ config: { repository: "ana/bot", tokenSecret: "AGENT_GITHUB", mergeTokenSecret: "MERGE_GITHUB" }, answers: [true, "", "", ""] });
  expect(await configure(t.io, () => "https://github.com/someone/else")).toEqual([]);
  expect(t.asked.slice(1)).toEqual(["The project's GitHub repository, owner/name (Enter: ana/bot): ", "AGENT_GITHUB (Enter skips): ", "MERGE_GITHUB (Enter skips): "]);
  expect(t.env.size).toBe(0);
  // Unchanged: not written again.
  expect(t.config).toEqual({ repository: "ana/bot", tokenSecret: "AGENT_GITHUB", mergeTokenSecret: "MERGE_GITHUB" });
});
