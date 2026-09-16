# Replay protocol lab

This directory is a headless experiment for an append-only run ledger,
content-addressed payloads and deterministic time travel. It is retained for
protocol and long-horizon-state experiments because its projection functions
can be tested without SolidJS, the server or a model call.

It is not a second application replay implementation:

- production recorded cases live in `frontend/workspace/src/pages/cases`;
- the workspace reuses the normal `SessionTurn` and tool renderers;
- this lab must not register a workspace route or define production UI state;
- useful protocol behavior should move behind a server contract before the
  workspace consumes it.

The `schema.ts` event union is the input contract. `validate.ts` checks sequence,
content and digest invariants. `engine.ts` provides deterministic projection
and checkpoints. `livemode.ts` reduces tool stream events into one run card.
Fixtures and tests cover both projection and condensed live presentation.

Run the lab checks from the repository root:

```bash
bun test tracer/replay/v2
bun tracer/replay/v2/run-validate.ts
```
