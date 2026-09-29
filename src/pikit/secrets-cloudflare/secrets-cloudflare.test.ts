/**
 * secrets-cloudflare's tests. They are copied with the component and keep running in your project,
 * under `bun test`, with a Worker `env` of their own in `WORKERS_HOST`. pikit runs the same suite in
 * workerd, over a real Worker's `env` (`tests/workerd`).
 */

import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, defineApp, defineComponent, silentLogger, withContextValue } from "@pikit/core";
import { type SecretStore, WORKERS_HOST } from "@pikit/contracts";
import { createSecretStoreConformance, withWorkersHost } from "@pikit/contracts/testing";
import secretsCloudflare from "./index.ts";

// The secrets contract (SPEC §14), over an env seeded by the suite.
for (const c of createSecretStoreConformance((secrets) => ({ components: withWorkersHost({ env: secrets }, [secretsCloudflare]) }))) {
  test(`secrets-cloudflare ${c.group}: ${c.name}`, () => c.run());
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [secretsCloudflare], logger: silentLogger }).create();
  expect(app.describe().components).toEqual([{ name: "secrets-cloudflare", provides: ["secrets"], requires: [], optional: [] }]);
});

test("only string values are secrets: a binding in env reads undefined", async () => {
  let secrets: SecretStore | undefined;
  const reader = defineComponent({
    name: "secrets-reader",
    setup(pikit) {
      const handle = pikit.use("secrets");
      return { start: () => void (secrets = handle.get()) };
    },
  });
  const env = { TOKEN: "t0k3n", OBJECTS: { idFromName: () => "id" }, PORT: 8080 };
  const app = await defineApp({ components: [secretsCloudflare, reader], logger: silentLogger }).create();
  // The way deployment-cloudflare's entrypoint passes it.
  await app.start(withContextValue(WORKERS_HOST, { env }, BACKGROUND_CONTEXT));
  expect(await secrets?.get("TOKEN")).toBe("t0k3n");
  expect(await secrets?.get("OBJECTS")).toBeUndefined();
  expect(await secrets?.get("PORT")).toBeUndefined();
  await app.stop();
});

test("off Cloudflare it refuses to start, and says what to use instead", async () => {
  const app = await defineApp({ components: [secretsCloudflare], logger: silentLogger }).create();
  const error = await app.start().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(Error);
  expect(String((error as Error).cause)).toContain("secrets-cloudflare: no WORKERS_HOST in the start context");
});
