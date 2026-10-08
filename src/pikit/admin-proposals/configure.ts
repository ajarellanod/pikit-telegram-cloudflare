/**
 * admin-proposals' step of `pikit configure`: connecting self-improvement, which is optional. The CLI
 * finds this file in an installed component and calls `configure(io)`; it knows nothing about GitHub.
 *
 * - **Already connected** (a repository in pikit.config.ts, both tokens set): it says so and asks
 *   nothing.
 * - **In a terminal**, otherwise: what it is, then whether to connect it now. Yes: the repository
 *   (`git remote get-url origin`'s when it is on GitHub, as the default), written to pikit.config.ts,
 *   the deployed default of the dashboard's setting; the two tokens, each asked without echo with the
 *   permissions it needs, written to `.env` (which `pikit up` sends to the Worker on Cloudflare, and a
 *   server reads); and how to create the ruleset on GitHub.
 * - **Without a terminal** it asks nothing, and nothing is missing: it stays dormant until connected,
 *   here or from the dashboard's Settings → Self-improvement.
 *
 * It never prints a token, and never calls GitHub: the dashboard's Settings → Self-improvement checks
 * the connection live. The CLI runs it on this machine, in the project's directory, never in the app.
 */

import { execFileSync } from "node:child_process";

/** What `pikit configure` gives a component's step. Structural, so this file imports nothing from the CLI. */
export interface ConfigureIO {
  /** A person answers at a terminal. False in scripts and CI: ask nothing. */
  interactive: boolean;
  /** This component's entry in pikit.config.ts. */
  config: Readonly<Record<string, unknown>>;
  /** A variable from `.env`, or exported in the environment. */
  get(name: string): string | undefined;
  /** Write a variable to `.env` (mode 0600) now. */
  set(name: string, value: string): void;
  /** Set a key of this component's entry in pikit.config.ts (in both Apps' configs on Cloudflare). */
  setConfig(key: string, value: string): void;
  ask(question: string): Promise<string>;
  /** Asks without echoing the answer. */
  askSecret(question: string): Promise<string>;
  /** Yes or no; Enter gives `initialValue`. */
  confirm(message: string, initialValue: boolean): Promise<boolean>;
  say(line: string): void;
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `owner/name` of a GitHub URL (https, ssh, `git@github.com:`); `undefined` for anything else. */
export function githubRepositoryOf(url: string): string | undefined {
  const match = /^(?:https:\/\/(?:www\.)?|ssh:\/\/git@|git@)github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

/** The project's `origin` remote, when git has one. */
function originUrl(): string | undefined {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
  } catch {
    return undefined;
  }
}

const nameOf = (value: unknown, fallback: string) => (typeof value === "string" && value !== "" ? value : fallback);

/** Connects self-improvement when the person wants to; returns what is missing: never anything, it is optional. */
export async function configure(io: ConfigureIO, origin: () => string | undefined = originUrl): Promise<string[]> {
  const readName = nameOf(io.config.tokenSecret, "GITHUB_TOKEN");
  const mergeName = nameOf(io.config.mergeTokenSecret, "PIKIT_MERGE_TOKEN");
  const configured = nameOf(io.config.repository, "");
  const has = (name: string) => (io.get(name) ?? "") !== "";
  if (configured !== "" && has(readName) && has(mergeName)) {
    io.say(`  Self-improvement: ${configured}, with ${readName} and ${mergeName} set`);
    return [];
  }
  if (!io.interactive) return [];

  io.say("\nSelf-improvement (optional): your agent proposes changes to itself as pull requests on the project's GitHub repository,");
  io.say("  which you approve or reject in the dashboard's Proposals. It stays off until it is connected (here, or later from the");
  io.say("  dashboard's Settings → Self-improvement): a repository, two GitHub tokens, and a ruleset on GitHub.");
  if (!(await io.confirm("Connect self-improvement now?", false))) {
    io.say("  Skipped: connect it later with `pikit configure`, or from the dashboard's Settings → Self-improvement");
    return [];
  }

  const suggested = configured !== "" ? configured : (githubRepositoryOf(origin() ?? "") ?? "");
  let repository = "";
  while (repository === "") {
    const answer = (await io.ask(`The project's GitHub repository, owner/name${suggested === "" ? "" : ` (Enter: ${suggested})`}: `)).trim();
    const chosen = answer === "" ? suggested : (githubRepositoryOf(answer) ?? answer);
    if (chosen === "") {
      io.say("  No repository: self-improvement stays off");
      return [];
    }
    if (REPOSITORY.test(chosen)) repository = chosen;
    else io.say(`  "${chosen}" is not owner/name (or a github.com URL)`);
  }
  if (repository !== configured) io.setConfig("repository", repository);

  io.say(`\nTwo fine-grained GitHub tokens, each for ${repository} only: https://github.com/settings/personal-access-tokens/new`);
  io.say(`  ${readName}, the agent's: Contents and Pull requests read and write (it pushes pikit/self/* branches, opens pull requests), Checks and Commit statuses read.`);
  io.say(`  ${mergeName}, yours, for Approve and Reject in the dashboard: Contents and Pull requests read and write. Another token: the agent never holds it.`);
  /** A token asked without echo, kept when set; never the same as `other`. Enter skips. */
  const token = async (name: string, other?: string): Promise<void> => {
    if (has(name)) {
      io.say(`  ${name}: already set`);
      return;
    }
    for (;;) {
      const value = (await io.askSecret(`${name} (Enter skips): `)).trim();
      if (value === "") {
        io.say(`  Skipped: ${name} is not set (\`pikit configure\` again, or .env)`);
        return;
      }
      if (other !== undefined && value === other) {
        io.say(`  That is ${readName}: merging needs a token of its own`);
        continue;
      }
      io.set(name, value);
      return;
    }
  };
  await token(readName);
  await token(mergeName, io.get(readName));

  io.say(`\nProtect the default branch: https://github.com/${repository}/settings/rules → New ruleset → New branch ruleset:`);
  io.say("  Enforcement Active, target the default branch, Require a pull request before merging, Require status checks to pass");
  io.say("  (`checks`, from .github/workflows/pikit-checks.yml), Block force pushes.");
  io.say("  On Cloudflare the agent pushes only where its workspace allows (execution-do's git.pushRepositories, or the dashboard's Settings → Self-improvement).");
  io.say("  The tokens reach the app with the next `pikit up` (or `pikit dev`); the dashboard's Settings → Self-improvement checks the connection.");
  return [];
}
