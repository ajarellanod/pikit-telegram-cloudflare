# router-basic

Every message goes to one agent: `defaultAgent`.

- **Provides:** nothing. It adds the stage `router-basic` to the `route.resolve` pipeline.
- **Uses:** `agent.definition`, to check at start that `defaultAgent` exists.
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

## Config

```ts
"router-basic": {
  defaultAgent: "assistant", // required
}
```

## Tests

`router-basic.test.ts` is copied with the component and runs in your project. It covers the
lifecycle conformance suite, routing to `defaultAgent`, an earlier decision left alone, and the
start failure.

`component.json` is generated from `setup` by `pikit registry generate` and is not written by hand;
the test "what setup declares" pins it.
