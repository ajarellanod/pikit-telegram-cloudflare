/**
 * deployment-cloudflare: runs a pikit project on Cloudflare Workers and Durable Objects (SPEC §4.1).
 *
 * It is not an app component: it runs the project's Apps rather than running inside them, so it is not
 * listed in `pikit.config.ts`. It owns three things:
 * - the entrypoint `wrangler.jsonc` deploys (`worker.ts` → `entrypoint.ts` → `host.ts`): the Worker
 *   runs `export const worker`, each `Conversation` Durable Object runs the default export, and both
 *   find the platform in `WORKERS_HOST` (C1, C4, C5);
 * - `wrangler.jsonc`, at the project's root;
 * - the commands the CLI delegates to (`up`, `down`, `logs`, `status`, `dev`), each one `wrangler …`;
 *   `up` then runs the installed components' `afterDeploy` hooks, once the new version answers (C8).
 *
 * This file exports only what runs on the machine and what is neutral: `entrypoint.ts` imports
 * `cloudflare:workers` and loads only in workerd.
 *
 * Target: `cloudflare`.
 */

export {
  createObjectHost,
  createWorkerHost,
  HEALTH_OBJECT,
  OBJECT_BINDING,
  ROLLBACK_DEADLINE_MS,
  START_DEADLINE_MS,
  VERSION_BINDING,
  type HostOptions,
  type ObjectHost,
  type ObjectNamespace,
  type ObjectState,
  type WorkerHost,
} from "./host.ts";
export {
  type AccountOptions,
  type AfterDeployIO,
  type DeployHook,
  LOGIN_HELP,
  login,
  deployFailure,
  up,
  down,
  logs,
  status,
  dev,
  deployHooks,
  deploySecrets,
  parseDeployments,
  readDeployOutput,
  spawnRunner,
  workerName,
  type CommandOptions,
  type Deployed,
  type Deployment,
  type DownOptions,
  type LogsOptions,
  type Probe,
  type RunResult,
  type Runner,
  type Status,
  type StatusOptions,
  type UpOptions,
} from "./commands.ts";
