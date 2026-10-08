/** The types of `rollout.mjs`, plain JavaScript so that Node runs it in a build without pikit. */

/** What a deploy deployed, and where it answers. */
export interface Deployed {
  /** The Worker version wrangler uploaded, as `/health` reports it. */
  version: string;
  /** Where `/health` is asked: the `workers.dev` URL wrangler reported, or the one given. */
  url: string;
}

/** One deployment: which versions serve, and how much of the traffic each one gets. */
export interface Deployment {
  id: string;
  created: string;
  message?: string;
  versions: { id: string; percentage: number }[];
}

export type Outcome = { kind: "ok" } | { kind: "failing"; detail: string } | { kind: "timeout"; detail: string };

/** What `rollBack` did. */
export type Rollback =
  | { kind: "rolled-back"; to: string }
  /** This deploy changed the Durable Object classes: `mark` is its tag, `previous` the version `to`'s. Nothing was rolled back. */
  | { kind: "migration"; to: string; mark: string; previous: string }
  /** No earlier version to go back to (a first deploy). */
  | { kind: "none" }
  | { kind: "failed"; to?: string; detail: string };

/** Runs `wrangler <args>`; with `capture`, resolves with its stdout. */
export type Wrangler = (args: string[], capture: boolean) => Promise<{ code: number; stdout: string }>;

export function parseJsonc(text: string): unknown;
export function migrationsMark(config: unknown): string;
export function readMigrationsMark(cwd: string): string | undefined;
export function readDeployOutput(path: string, url?: string | URL | undefined): Deployed;
export function deployedFrom(lines: string[], url?: string | URL | undefined): Deployed;
export function parseDeployments(output: string): Deployment[];
export function probeHealth(
  url: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number | "unreachable"; ok?: boolean; version?: string | null; error?: string }>;
export const WAIT_MS: number;
export const INTERVAL_MS: number;
export function waitForVersion(deployed: Deployed, options?: { fetch?: typeof fetch | undefined; waitMs?: number | undefined; intervalMs?: number | undefined }): Promise<Outcome>;
export function healthFailure(deployed: Deployed, outcome: Exclude<Outcome, { kind: "ok" }>, waitMs?: number): string;
export function rollBack(options: { wrangler: Wrangler; name?: string | undefined; deployed: Deployed; mark?: string | undefined }): Promise<Rollback>;
export function rollbackLine(version: string, result: Rollback): string;
