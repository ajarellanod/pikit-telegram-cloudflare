# router-basic

Every message goes to one agent: `defaultAgent`.

- **Provides:** nothing. It adds the stage `router-basic` to the `route.resolve` pipeline.
- **Uses:** `agent.definition`, to check at start that `defaultAgent` exists; `settings`, if
  installed (`settings-store`), for the default agent an operator sets live ("From the dashboard" below).
- **Settings section:** `settings/`, the dashboard's Settings, **Agent**: installed to
  `src/dashboard/src/settings/router-basic/` when the project has a UI.
- **Targets:** `server` and `durable`.
- **Installs to:** `src/pikit/router-basic/`.
- **npm dependencies:** `typebox`.

## What it does

When no earlier stage of `route.resolve` has decided, this stage sends the message to
`defaultAgent`. A decision that is already there is left alone. A project stage with a higher
priority can therefore route some messages to another agent, or deny them, and this router still
answers the rest:

```ts
pikit.pipeline("route.resolve", (value) =>
  value.message.text.includes("invoice")
    ? { ...value, decision: { agent: "billing", access: "allow" } }
    : value,
  { id: "billing", priority: 10 },
);
```

Routing by channel, tenant or content is a different router component, not a config key here.
`defaultAgent` is a value, not a strategy.

It refuses to start when `defaultAgent` names no agent.

## From the dashboard

With `settings-store` installed (it comes with the dashboard), the default agent is also a setting:
an operator picks it in Settings, **Agent**, among the App's agents, and the next message no other
stage routed goes to it, with no deploy and no restart. Its default is `defaultAgent`, which stays the
deployed value: the setting overrides it while it names an agent. One that does not anymore (a deploy
removed it), or settings that cannot be read, fall back to `defaultAgent`, logged.

The same section changes that agent's system prompt, model and tools, which are runtime-pi's settings
(its README, "Live overrides"): router-basic is always installed, so its section is where an operator
finds the agent.

## Config

```ts
"router-basic": {
  defaultAgent: "assistant", // required
}
```

## Tests

`router-basic.test.ts` is copied with the component and runs in your project. It covers the
lifecycle conformance suite, routing to `defaultAgent`, an earlier decision left alone, the
start failure, and with `settings` (a double) the default agent set live, and `defaultAgent` again
when the setting names no agent or cannot be read.

`component.json` is generated from `setup` by `pikit registry generate` and is not written by hand;
the test "what setup declares" pins it.
