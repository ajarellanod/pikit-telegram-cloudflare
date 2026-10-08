/**
 * The dashboard's files as admin-api serves them, from the module the dashboard's build writes
 * (`dashboard-files.ts`: path → base64): the same rules on every host.
 */

import { expect, test } from "bun:test";
import { createAssets, type DashboardFiles } from "./assets.ts";
import { DASHBOARD_FILES } from "./dashboard-files.ts";

const base64 = (text: string) => Buffer.from(text).toString("base64");

const BUILT: DashboardFiles = {
  "index.html": base64("<!doctype html><div id=root></div>"),
  "assets/index-abc123.js": base64("console.log(1)"),
  "favicon.svg": base64("<svg/>"),
  "fonts/geist.woff2": Buffer.from([0, 1, 2, 255]).toString("base64"),
};

test("served under /admin/ to anyone; pages fall back to index.html; assets/ is immutable", async () => {
  const assets = createAssets(BUILT);

  const root = assets.serve("/admin");
  expect(root.status).toBe(308);
  expect(root.headers.get("location")).toBe("/admin/");

  const index = assets.serve("/admin/");
  expect(index.status).toBe(200);
  expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(index.headers.get("cache-control")).toBe("no-cache");
  expect(index.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await index.text()).toContain("id=root");

  const script = assets.serve("/admin/assets/index-abc123.js");
  expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  expect(script.headers.get("cache-control")).toContain("immutable");
  expect(await script.text()).toBe("console.log(1)");

  expect(assets.serve("/admin/favicon.svg").headers.get("content-type")).toBe("image/svg+xml");
  // Binary files keep their bytes.
  expect([...new Uint8Array(await assets.serve("/admin/fonts/geist.woff2").arrayBuffer())]).toEqual([0, 1, 2, 255]);
  // A page of the app (an id with `:` and `~`, as on Cloudflare), and the same file twice.
  expect(await assets.serve("/admin/conversations/telegram%3A1~2").text()).toContain("id=root");
  // An id with `.`, `@` or an encoded `/` is a page too, not a file: a reload shows it.
  for (const path of ["/admin/conversations/email%3Aana%40empresa.com~1", "/admin/conversations/email:ana@empresa.com~1", "/admin/conversations/a%2Fb.json~3", "/admin/conversations/x.js"]) {
    const page = assets.serve(path);
    expect({ path, status: page.status, type: page.headers.get("content-type") }).toEqual({ path, status: 200, type: "text/html; charset=utf-8" });
  }
  // The policy, whole: images also `data:` (a transcript's) and `blob:` (one attached, not sent yet), forms also to GitHub (github-app's Connect); nothing else loosened.
  expect(index.headers.get("content-security-policy")).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; " +
      "object-src 'none'; base-uri 'self'; form-action 'self' https://github.com; frame-ancestors 'none'",
  );
  expect(await assets.serve("/admin/").text()).toContain("id=root");
  expect(assets.serve("/admin/assets/missing.js").status).toBe(404);
  expect(assets.built()).toBe(true);
});

test("a path is looked up among the files only: none leaves them (a page gets index.html, assets/ a 404)", async () => {
  const assets = createAssets({ ...BUILT, "secret.txt": base64("outside") });

  for (const path of ["/admin/..%2Fsecret.txt", "/admin/%2e%2e/secret.txt", "/admin/%E0", "/admin/a%00b.js", "/admin/..%5Cx.txt", "/admin/assets%2Findex-abc123.js"]) {
    const response = assets.serve(path);
    expect({ path, status: response.status, page: (await response.text()).includes("id=root") }).toEqual({ path, status: 200, page: true });
  }
  for (const path of ["/admin/assets/..%2F..%2Fsecret.txt", "/admin/assets/%E0", "/admin/assets/a%00b.js"]) {
    const response = assets.serve(path);
    expect({ path, status: response.status, text: await response.text() }).toEqual({ path, status: 404, text: "not found" });
  }
  // `.` segments are nothing, as in a URL.
  expect(await assets.serve("/admin/./assets/index-abc123.js").text()).toBe("console.log(1)");
});

test("without a built dashboard /admin/ says why there is no page", async () => {
  const assets = createAssets({});

  expect(assets.built()).toBe(false);
  const page = assets.serve("/admin/conversations");
  expect(page.status).toBe(404);
  expect(await page.text()).toContain("no dashboard is built");
});

test("what the dashboard's build wrote (dashboard-files.ts) is served: index.html when it built one", async () => {
  const assets = createAssets(DASHBOARD_FILES);

  expect(assets.serve("/admin/").status).toBe(assets.built() ? 200 : 404);
  for (const path of Object.keys(DASHBOARD_FILES)) expect({ path, status: assets.serve(`/admin/${path}`).status }).toEqual({ path, status: 200 });
});
