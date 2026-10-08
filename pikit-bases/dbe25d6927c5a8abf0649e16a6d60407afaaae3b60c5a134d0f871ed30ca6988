/**
 * router-basic: every message goes to one agent, `defaultAgent` (`route.resolve`, in @pikit/contracts' inbound.ts).
 *
 * It adds a stage to `route.resolve` that fills in the decision when no earlier stage made one. A
 * project stage with a higher priority can route some messages elsewhere (or deny them), and this
 * router still answers the rest. Routing by channel, tenant or content is another router component,
 * not a config key here (values in config, behavior in code: MANIFESTO, principle 8): `defaultAgent` is a value, not a strategy.
 *
 * It refuses to start when `defaultAgent` names no `agent.definition`: a router that sends every
 * message to an agent that does not exist is a broken deployment.
 *
 * **A setting too** (`settings`, when a provider is installed; features/settings.md): an operator may
 * change which agent answers by default from the dashboard (its Agent section, `settings/`), live. Its
 * default is the config's `defaultAgent`. It is read at every message this stage routes, and used only
 * while it names an `agent.definition`; otherwise, or when the settings cannot be read, the config's
 * applies (logged).
 *
 * Targets: `server` and `durable` (it imports nothing platform-specific).
 */

import { type AppContext, defineComponent } from "@pikit/core";
import Type from "typebox";

const Config = Type.Object({
  /** The agent that answers every message no other stage routed. */
  defaultAgent: Type.String({ minLength: 1 }),
});

/** Its settings: the default agent, among the App's agents. */
export type RouterSettings = { defaultAgent: string };

export default defineComponent({
  name: "router-basic",
  config: Config,
  setup(pikit, config) {
    const agents = pikit.useKeyed("agent.definition");
    const settings = pikit.useOptional("settings");
    let declared = false;

    /** The agent that answers by default now: the operator's, while it is an agent; else the config's. */
    const defaultAgent = async (ctx: AppContext): Promise<string> => {
      const store = settings.get();
      if (store === undefined || !declared) return config.defaultAgent;
      try {
        const { defaultAgent: chosen } = await store.get<RouterSettings>("router-basic", ctx);
        if (agents.get(chosen) !== undefined) return chosen;
        ctx.logger.warn("router-basic: the default agent set from the dashboard is not an agent; defaultAgent applies", { agent: chosen, defaultAgent: config.defaultAgent });
      } catch (error) {
        ctx.logger.warn("router-basic: its settings could not be read; defaultAgent applies", { error: error instanceof Error ? error.message : String(error) });
      }
      return config.defaultAgent;
    };

    pikit.pipeline(
      "route.resolve",
      async (value, ctx) => (value.decision !== undefined ? value : { ...value, decision: { agent: await defaultAgent(ctx), access: "allow" } }),
      { id: "router-basic" },
    );

    return {
      start() {
        if (agents.get(config.defaultAgent) === undefined) {
          const known = agents.keys().map((name) => `"${name}"`).join(", ") || "none";
          throw new Error(`router-basic: defaultAgent "${config.defaultAgent}" is not an agent.definition (agents: ${known})`);
        }
        const store = settings.get();
        if (store === undefined) return;
        const names = agents.keys().sort();
        store.declare(
          "router-basic",
          Type.Object(
            {
              defaultAgent: Type.Union(
                names.map((name) => Type.Literal(name)),
                { title: "Default agent", description: "The agent that answers every message no other rule routed." },
              ),
            },
            { additionalProperties: false },
          ),
          { defaultAgent: config.defaultAgent },
        );
        declared = true;
      },
      stop() {
        declared = false;
      },
    };
  },
});
