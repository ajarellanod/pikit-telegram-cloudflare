/**
 * The composition root (SPEC §4.1) of a project on Cloudflare: two Apps (SPEC C1), and everything
 * that runs is listed in their `components`. Follow the imports to read it all.
 *
 * - The default export runs in each conversation's Durable Object: the channel's other half, the
 *   router, the runtime, sessions, storage, delivery. `pikit add` lists every component here.
 * - `worker` runs in the Worker, which receives every request first: the ingress half of each
 *   channel, the mailbox, secrets. The Worker checks and routes; the object owns the conversation.
 *   `pikit add` lists here a component's Worker half (`channelTelegramWebhookWorker`, configured
 *   under `"channel-telegram-webhook-worker"` in `workerConfig`), or a component that works in both
 *   Apps (`secrets-cloudflare`).
 *
 * `pikit add` and `pikit remove` edit this file: one import line per component, one entry per line
 * in `components`, and one key per component in `config`. Edit it yourself too; keep that shape.
 * deployment-cloudflare runs both Apps (`src/pikit/deployment-cloudflare/worker.ts`).
 */

import { defineApp } from "@pikit/core";
import agents from "./src/extensions/agents.ts";
// Pi's own permission-gate extension, unmodified: it blocks `rm -rf`, `sudo` and `chmod 777` in
// `bash`. A policy, not a sandbox.
import permissionGate from "./src/extensions/permission-gate.ts";
import secretsCloudflare from "./src/pikit/secrets-cloudflare/index.ts";
import platformCloudflare from "./src/pikit/platform-cloudflare/index.ts";
import storageDo from "./src/pikit/storage-do/index.ts";
import storageKvSql from "./src/pikit/storage-kv-sql/index.ts";
import submissionsSql from "./src/pikit/submissions-sql/index.ts";
import sessionsSql from "./src/pikit/sessions-sql/index.ts";
import conversationsKv from "./src/pikit/conversations-kv/index.ts";
import providerOpenrouter from "./src/pikit/provider-openrouter/index.ts";
import { createRuntimePi } from "./src/pikit/runtime-pi/index.ts";
import routerBasic from "./src/pikit/router-basic/index.ts";
import outboundDurable from "./src/pikit/outbound-durable/index.ts";
import channelTelegramWebhook, { worker as channelTelegramWebhookWorker } from "./src/pikit/channel-telegram-webhook/index.ts";
import executionDo from "./src/pikit/execution-do/index.ts";
import toolRead from "./src/pikit/tool-read/index.ts";
import toolWrite from "./src/pikit/tool-write/index.ts";
import toolEdit from "./src/pikit/tool-edit/index.ts";
import toolBash from "./src/pikit/tool-bash/index.ts";
import toolFetch from "./src/pikit/tool-fetch/index.ts";
import toolWebsearchBrave from "./src/pikit/tool-websearch-brave/index.ts";

/** Values, not behaviour (SPEC §12), under each component's name: the object's App. */
export const config = {
  "router-basic": { defaultAgent: "assistant" },
};

/** Each conversation's Durable Object runs this App. */
export default defineApp({
  components: [
    agents,
    secretsCloudflare,
    platformCloudflare,
    storageDo,
    storageKvSql,
    submissionsSql,
    sessionsSql,
    conversationsKv,
    providerOpenrouter,
    createRuntimePi({ extensions: [permissionGate] }),
    routerBasic,
    outboundDurable,
    channelTelegramWebhook,
    executionDo,
    toolRead,
    toolWrite,
    toolEdit,
    toolBash,
    toolFetch,
    toolWebsearchBrave,
  ],
  config,
});

/** The Worker's config, under each of its components' names. */
export const workerConfig = {};

/** The Worker runs this App: its components' `http.route`s are what it serves, besides `GET /health`. */
export const worker = defineApp({
  components: [
    secretsCloudflare,
    platformCloudflare,
    channelTelegramWebhookWorker,
  ],
  config: workerConfig,
});
