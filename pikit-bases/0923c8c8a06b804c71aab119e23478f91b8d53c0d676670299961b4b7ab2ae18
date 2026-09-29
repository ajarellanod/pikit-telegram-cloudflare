/**
 * The Worker `wrangler.jsonc` deploys (`main`): the project's two Apps from `pikit.config.ts`, the
 * default export in each `Conversation` Durable Object and `export const worker` in the Worker
 * (SPEC §4.1, C1). Change the deadlines or the logger here, in `createEntrypoint`'s options.
 */

import type { AppDefinition } from "@pikit/core";
// @ts-ignore: in the registry this file has no project around it. Installed at
// `src/pikit/deployment-cloudflare/`, the import resolves to the project's root and is type-checked.
import * as project from "../../../pikit.config.ts";
import { createEntrypoint } from "./entrypoint.ts";

const apps = project as { default: AppDefinition; worker?: AppDefinition };
const entrypoint = createEntrypoint(apps.default, apps.worker);

export const Conversation = entrypoint.Conversation;
export default entrypoint.handler;
