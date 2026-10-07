/**
 * provider-openrouter's tests. They are copied with the component and keep running in your project.
 * They make no request to OpenRouter and read no credential: `apiBase` points a model at a local fake.
 */

import { expect, test } from "bun:test";
import { defineApp, defineComponent, silentLogger } from "@pikit/core";
import { modelsFrom, type Provider } from "@pikit/pi-adapter";
import { startFakeOpenRouter } from "./fake-openrouter.test-support.ts";
import providerOpenRouter, { API_BASE } from "./index.ts";

/** The provider the component provides under `openrouter`, with `config` as its config. */
async function providerWith(config?: Record<string, unknown>): Promise<{ provider: Provider | undefined; stop(): Promise<void> }> {
  let provider: Provider | undefined;
  const reader = defineComponent({
    name: "provider-reader",
    setup(pikit) {
      const providers = pikit.useKeyed("model.provider");
      return { start: () => void (provider = providers.get("openrouter")) };
    },
  });
  const app = await defineApp({
    components: [providerOpenRouter, reader],
    ...(config !== undefined && { config: { "provider-openrouter": config } }),
    logger: silentLogger,
  }).create();
  await app.start();
  return { provider, stop: () => app.stop() };
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [providerOpenRouter], logger: silentLogger }).create();

  expect(app.describe().components).toEqual([{ name: "provider-openrouter", provides: ["model.provider"], requires: [], optional: [] }]);
  expect(app.describe().capabilities["model.provider"]).toEqual({ providers: ["provider-openrouter"], keys: { openrouter: "provider-openrouter" } });
});

test("it provides pi-ai's OpenRouter provider under the key openrouter, with API-key sign-in and <vendor>/<model> ids", async () => {
  let provider: Provider | undefined;
  const reader = defineComponent({
    name: "provider-reader",
    setup(pikit) {
      const providers = pikit.useKeyed("model.provider");
      return { start: () => void (provider = providers.get("openrouter")) };
    },
  });
  const app = await defineApp({ components: [providerOpenRouter, reader], logger: silentLogger }).create();
  await app.start();

  expect(provider?.id).toBe("openrouter");
  expect(provider?.auth.apiKey).toBeDefined();
  // An agent's `openrouter/z-ai/glm-5.3-flash`: the provider before the first slash, the model id after.
  expect(modelsFrom(provider === undefined ? [] : [provider]).getModel("openrouter", "z-ai/glm-5.3-flash")?.id).toBe("z-ai/glm-5.3-flash");
  await app.stop();
});

test("apiBase moves the provider's address and its image and classifier models too; a trailing slash on the default changes nothing", async () => {
  const slash = await providerWith({ apiBase: `${API_BASE}/` });
  const plain = await providerWith();
  const proxy = await providerWith({ apiBase: "http://127.0.0.1:9999/proxy/" });
  try {
    const provider = proxy.provider as Provider;
    expect(provider.baseUrl).toBe("http://127.0.0.1:9999/proxy/v1");
    expect(slash.provider?.getModels()).toEqual(plain.provider?.getModels() ?? []);
    const all = provider.getAllModels?.() ?? [];
    expect(all.length).toBeGreaterThan(provider.getModels().length);
    expect(all.every((model) => !model.baseUrl.startsWith(API_BASE))).toBe(true);
  } finally {
    await slash.stop();
    await plain.stop();
    await proxy.stop();
  }
});

test("by default every model is OpenRouter's; apiBase moves them all under it, and a model answers from there with the key", async () => {
  const plain = await providerWith();
  const models = plain.provider?.getModels() ?? [];
  expect(models.length).toBeGreaterThan(0);
  expect(models.every((model) => model.baseUrl?.startsWith("https://openrouter.ai/api"))).toBe(true);
  await plain.stop();

  const fake = startFakeOpenRouter();
  const moved = await providerWith({ apiBase: `${fake.url}/` });
  try {
    const provider = moved.provider as Provider;
    expect(provider.id).toBe("openrouter");
    expect(provider.getModels().every((model) => model.baseUrl?.startsWith(fake.url))).toBe(true);
    const all = modelsFrom([provider]);
    const model = all.getModel("openrouter", "z-ai/glm-5.3-flash");
    expect(model?.baseUrl).toBe(`${fake.url}/v1`);

    const answer = await all.completeSimple(
      model as NonNullable<typeof model>,
      { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
      { apiKey: "sk-or-test" },
    );
    expect(answer.content).toEqual([{ type: "text", text: "answer: hello" }]);
    expect(fake.requests).toEqual([{ model: "z-ai/glm-5.3-flash", apiKey: "sk-or-test", messages: [expect.objectContaining({ role: "user" })] }]);
  } finally {
    await moved.stop();
    await fake.stop();
  }
});
