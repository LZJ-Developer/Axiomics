# Upstream integration guide

Axiomics keeps the `upstream` remote as a read-only source for updates. Product-specific work stays in focused modules so upstream changes can be reviewed and merged without reapplying broad patches.

## Product invariants

- The product name, CLI command, package scope, environment prefix, configuration paths, desktop application ID, and Python module namespace use Axiomics identifiers.
- The default distribution is local-first. It does not contact a hosted account, billing, model proxy, or managed compute endpoint unless an operator explicitly configures one.
- The scientific workspace supports durable sessions, provenance, artifacts, scientific file previews, local kernels, and governed remote compute.
- Case replay preserves the recorded event order. A shell invocation and its result are one replay step, the newest disclosed card opens automatically, and earlier cards fold as the cursor advances.
- Legal attribution inherited under Apache-2.0 is kept in `NOTICE`; product copy and runtime assets contain only the current identity.

## Integration boundaries

| Area           | Product-owned surface                                            | Upstream-sensitive seam                                  |
| -------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| CLI and server | `backend/cli/src/science`, compute, artifacts, research sessions | server routes, session message schema, provider adapters |
| Workspace      | `frontend/workspace/src/atlas`, cases and replay                 | shared session store, router, `@axiomics/ui` components  |
| Shared UI      | reusable scientific viewers and disclosure controls              | generic message and tool rendering contracts             |
| SDK            | generated clients under `tooling/sdk`                            | OpenAPI schema emitted by the server                     |
| Distribution   | package names, launcher, installer, desktop metadata             | upstream build and release scripts                       |

Keep replay state in the cases feature. Shared UI may expose generic controlled disclosure contracts, but must not import replay state or cases modules.

## Review layers

Review and land product changes in this order. Each layer has one reason to
change, and later layers may depend on earlier ones.

| Layer                          | Purpose                                                                                                       | Primary paths                                                                                 | Review rule                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Identity                    | Product name, package scope, commands, assets and documentation namespace                                     | root metadata, `.axiomics`, `assets`, package manifests, docs content                         | Mechanical replacements only; no runtime behavior changes                                  |
| 2. Data and protocol namespace | Config/data roots, environment variables, application IDs, headers, manifest formats and remote-job ownership | `backend/cli/src/global`, `config`, `flag`, `axiomics`, `file/artifacts.ts`, compute, desktop | Treat every value as persisted or externally observed; state the upgrade policy explicitly |
| 3. Scientific runtime          | Kernels, connectors, provenance, immutable Results, research sessions and governed compute                    | `backend/cli/src/science`, `artifact`, `compute`, `research`, `session/research.ts`           | Keep domain behavior independent of the workspace UI and model vendor                      |
| 4. Workspace product           | Project browser, scientific viewers, settings and model/provider selection                                    | `frontend/workspace/src/atlas`, `artifacts`, `science`, `components/settings`                 | Consume server contracts through the SDK or a narrow route client                          |
| 5. Recorded cases              | Gallery, immutable snapshot projection, playback and generic card disclosure                                  | `frontend/workspace/src/pages/cases`, `frontend/ui/src/components/session-turn.tsx`           | A command and result remain one frame; shared UI exposes no replay-specific state          |
| 7. Generated clients           | OpenAPI snapshot and generated SDK sources                                                                    | `tooling/sdk`                                                                                 | Regenerate after server layers settle; do not hand-edit generated files                    |
| 8. Acceptance evidence         | Claims, matrices, demo scripts and expert material                                                            | `docs/acceptance`                                                                             | Documents may cite runtime evidence but runtime code must never import them                |

The Axiomics namespace starts a new product data generation. It does not
silently load configuration, credentials, account state or active remote jobs
from a predecessor product. Within an Axiomics release line, persisted formats
and protocol values are compatibility contracts: change them only with a
versioned reader, an explicit migration, and an integration test.

The standalone replay lab under `tracer/replay/v2` is an executable protocol
experiment. It must not register application routes or become a second
production renderer. The canonical product implementation lives under
`frontend/workspace/src/pages/cases` and reuses the normal session renderer.

## Update workflow

1. Fetch and inspect the upstream range before merging.
2. Merge upstream `main` into a dedicated integration branch.
3. Resolve conflicts at the boundaries above and preserve the product invariants.
4. Regenerate the JavaScript SDK with `./tooling/repo/generate.ts` when the server contract changes.
5. Run formatting, type checks, focused tests, the full backend suite from `backend/cli`, and production builds.
6. Scan tracked source, paths, generated packages, and distributable assets for retired identifiers before release.

For a large product migration, prepare the review as a commit stack matching
the layers above. Do not mix generated SDK churn or acceptance prose into a
runtime behavior commit. Run the relevant focused tests after every behavior
layer, then run the full release checks on the final stack.

Avoid compatibility aliases for names that were never published by Axiomics. If a persisted data layout changes, implement a narrow one-way migration from the exact previous path and cover it with an integration test.

## Release checks

```bash
bun install
bun run typecheck
cd backend/cli && bun test
cd ../.. && ./tooling/repo/generate.ts
```

Production releases must also build the workspace, native CLI packages, desktop metadata, launcher, and installer from the same immutable source revision.
