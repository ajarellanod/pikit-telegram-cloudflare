/**
 * router-basic: every message goes to one agent, `defaultAgent` (SPEC §5).
 *
 * It adds a stage to `route.resolve` that fills in the decision when no earlier stage made one. A
 * project stage with a higher priority can route some messages elsewhere (or deny them), and this
 * router still answers the rest. Routing by channel, tenant or content is another router component,
 * not a config key here (S7): `defaultAgent` is a value, not a strategy.
 *
 * It refuses to start when `defaultAgent` names no `agent.definition`: a router that sends every
 * message to an agent that does not exist is a broken deployment.
 *
 * Targets: `server` and `cloudflare` (it imports nothing platform-specific).
 */

import { defineComponent } from "@pikit/core";
import Type from "typebox";

const Config = Type.Object({
  /** The agent that answers every message no other stage routed. */
  defaultAgent: Type.String({ minLength: 1 }),
});

export default defineComponent({
  name: "router-basic",
  config: Config,
  setup(pikit, config) {
    const agents = pikit.useKeyed("agent.definition");

    pikit.pipeline(
      "route.resolve",
      (value) => (value.decision !== undefined ? value : { ...value, decision: { agent: config.defaultAgent, access: "allow" } }),
      { id: "router-basic" },
    );

    return {
      start() {
        if (agents.get(config.defaultAgent) === undefined) {
          const known = agents.keys().map((name) => `"${name}"`).join(", ") || "none";
          throw new Error(`router-basic: defaultAgent "${config.defaultAgent}" is not an agent.definition (agents: ${known})`);
        }
      },
    };
  },
});
