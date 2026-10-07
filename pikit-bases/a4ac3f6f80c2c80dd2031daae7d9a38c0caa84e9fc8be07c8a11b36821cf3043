/**
 * provider-openrouter: the models OpenRouter serves, for your agents, named
 * `openrouter/<vendor>/<model>` (`openrouter/z-ai/glm-5.3-flash`). It provides the keyed capability
 * `model.provider` under the key `openrouter`.
 *
 * The provider is pi-ai's, imported by subpath through `@pikit/pi-adapter/providers/openrouter`, so
 * the app carries this provider and no other. Pi does the rest: requests, retries, and credentials.
 *
 * Credentials, in pi-ai's order:
 * 1. A credential stored for `openrouter` in `model.credentials`: an API key.
 * 2. Only when nothing is stored: the environment, `OPENROUTER_API_KEY`.
 *
 * Your OpenRouter account's guardrails (allowed providers, data policy, a budget) apply: a model they
 * exclude fails at its first request with OpenRouter's error, not at start.
 *
 * **`apiBase`** in config is OpenRouter's API (`https://openrouter.ai/api`) by default: every model's
 * address is under it (`<apiBase>/v1` for most). A proxy in front of OpenRouter, or a test double,
 * replaces it; `moved` below moves the chat, image and classifier models alike (pi-ai's factory takes
 * no base URL).
 *
 * Targets: `server` and `durable`: the provider's module imports nothing node-only, and an API key
 * needs nothing more.
 */

import { defineComponent } from "@pikit/core";
import type { Provider } from "@pikit/pi-adapter";
import { openrouterProvider } from "@pikit/pi-adapter/providers/openrouter";
import Type from "typebox";

/** Where pi-ai's catalogue puts every OpenRouter model: `<API_BASE>/v1`, or `<API_BASE>` itself. */
export const API_BASE = "https://openrouter.ai/api";

/** `provider` with every model's address under `apiBase` instead of `API_BASE`. A trailing slash is ignored. */
export function moved(provider: Provider, apiBase: string): Provider {
  const base = apiBase.replace(/\/+$/, "");
  if (base === API_BASE) return provider;
  const move = (baseUrl: string) => (baseUrl.startsWith(API_BASE) ? `${base}${baseUrl.slice(API_BASE.length)}` : baseUrl);
  const getAllModels = provider.getAllModels;
  // pi-ai's providers are plain objects (`createProvider`): spreading keeps every method.
  return {
    ...provider,
    ...(provider.baseUrl !== undefined && { baseUrl: move(provider.baseUrl) }),
    getModels: () => provider.getModels().map((model) => ({ ...model, baseUrl: move(model.baseUrl) })),
    ...(getAllModels !== undefined && {
      getAllModels: () => getAllModels.call(provider).map((model) => ({ ...model, baseUrl: move(model.baseUrl) })),
    }),
  };
}

const Config = Type.Object({
  /** OpenRouter's API. A value, for a proxy or a test double. */
  apiBase: Type.String({ minLength: 1, default: API_BASE }),
});

export default defineComponent({
  name: "provider-openrouter",
  config: Config,
  setup(pikit, config) {
    // Building the provider opens nothing: no connection, no credential read until a request.
    // The image and classifier models move with the chat ones.
    const provider = moved(openrouterProvider(), config.apiBase);
    pikit.provideKeyed("model.provider", provider.id, provider);
  },
});

