# Local verification

Before pushing to `main` (or opening a PR), run the full local gate set, so a
red build never reaches the default branch.

```bash
bun run format:check                     # Prettier
bun run typecheck                        # all workspaces (tsgo)
bun run --cwd frontend/workspace build
bun run --cwd backend/cli script/generate-web-assets.ts
bun run --cwd frontend/docs build
bun run --cwd backend/cli test           # CLI unit + integration suite
```

There is no hosted CI in this tree; every gate above is run locally. Start the
suite through the `test` script: it passes `--timeout 15000`, and bare
`bun test` fails spuriously at Bun's 5 s default.

Before a production release, verify the build from a clean checkout. After the candidate lands, dispatch the
main-only `test publish` workflow with packaged E2E, OS smoke, and scientific
canary inputs enabled. The
workflow also installs the exact candidate and runs all five packaged
scientific capability lifecycles on Linux x64, Linux ARM64, and macOS ARM64;
each evidence record must match the immutable source SHA compiled into that
candidate. `test` dist-tag promotion depends on all three evidence jobs.
Production publishing also verifies the exact-source run and every required
job through the GitHub Actions API; disabled or skipped candidate gates fail
closed. When Modal is an advertised backend, also install the exact candidate
in an isolated release-operator root and run
`axiomics debug capability-canary --all --target modal
--acknowledge-remote-cost`; retain the JSON report. The migration matrix, Windows Job
Object tests, macOS responsibility tests, Linux bubblewrap/OpenSSH integration
run on their native platforms; the exact `main` commit being released must be
green there. Run the Playwright E2E suite for changes to packaged browser flows.

Notes:

- `.mdx` documentation pages are intentionally excluded from prettier (its MDX
  parser is deprecated and can mangle JSX-in-markdown). Keep them plain-markdown
  and let the docs build validate them.
- The model catalog is fixtured in tests, so the suite is deterministic and runs
  offline; a nightly job checks the live catalog for delistings separately.
- Axiomics account routes degrade gracefully when signed out or
  offline — exercise both states when touching them.

## Release-specific evidence boundaries

- Native DeepSeek direct-BYOK routing and strict tool-schema normalization have
  deterministic contract coverage. A live official-API canary has not yet been
  recorded, so release claims must not describe that route as live-verified.
- The scientific capability registry contains 54 truthful inventory entries.
  Five experimental Python capabilities have full governed local/Modal
  lifecycles and exact runtime locks; ten experimental BioNeMo capabilities
  have strict BYOK NVIDIA NIM adapters; two entries are blocked. Source-tree
  local and Modal preparation canaries do not make a released package verified:
  require matching release-artifact evidence before changing maturity or making
  a live-verified claim. No live BioNeMo provider canary is implied by offline
  tests.
- Modal concurrency is an admission limit. A start beyond capacity should fail
  visibly; autonomous waiting-queue behavior is deferred and must not appear in
  product or release copy.
- Stable releases require signed, notarized macOS DMGs and updater ZIPs; there
  is no unsigned stable macOS channel. Both architectures must retain immutable
  GitHub digests and pass their native previous-stable upgrade, packaged
  main/sidecar health, cleanup, and injected safe-rollback canaries before the
  draft is made public. The Windows installer may be unsigned only when both
  optional Windows signing secrets are absent, with an explicit release note.
- Organization funding and team billing are not part of this release tree. PR
  #413 remains unmerged and must not be included in shipped-feature claims.
