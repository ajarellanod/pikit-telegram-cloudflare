/**
 * The build's last step (`bun run build`: `tsc -b && vite build && bun scripts/embed.ts`): `dist/` as a
 * module, `../pikit/admin-api/dashboard-files.ts` (path → its bytes in base64), which admin-api imports
 * and serves at `/admin/`. Bundled with the app, the dashboard is served the same way on every host, a
 * Cloudflare Worker included: no disk, no binding.
 *
 * Only where admin-api is installed (`src/pikit/admin-api/` next to this dashboard's folder); elsewhere
 * `dist/` is all the build makes. The module changes only when the built files do.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
const admin = join(root, "..", "pikit", "admin-api");
const target = join(admin, "dashboard-files.ts");

if (!existsSync(admin)) {
  console.log("embed: no ../pikit/admin-api/ next to the dashboard (admin-api is not installed): dist/ only");
  process.exit(0);
}
if (!existsSync(join(dist, "index.html"))) {
  console.error("embed: dist/index.html is missing: run `vite build` first");
  process.exit(1);
}

/** Every file under `dir`, as paths relative to `dist` with `/`, sorted. */
function files(dir: string, prefix = ""): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`]));
}

const entries = files(dist).map((path) => `  ${JSON.stringify(path)}: ${JSON.stringify(readFileSync(join(dist, path)).toString("base64"))},`);
const text = `/**
 * The dashboard's built files, written by its build (\`src/dashboard/\`: \`bun run build\`, whose last
 * step is \`scripts/embed.ts\`): do not edit. Path under \`dist/\` → its bytes in base64.
 */

import type { DashboardFiles } from "./assets.ts";

export const DASHBOARD_FILES: DashboardFiles = {
${entries.join("\n")}
};
`;

if (existsSync(target) && readFileSync(target, "utf8") === text) {
  console.log(`embed: ${target} is up to date (${entries.length} files)`);
} else {
  writeFileSync(target, text);
  console.log(`embed: ${entries.length} files into ${target}`);
}
