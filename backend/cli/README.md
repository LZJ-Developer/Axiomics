# @axiomics/axiomics

The CLI, local server, and agent runtime behind Axiomics — a full-workflow research agent for five classes of omics analysis: single-cell transcriptomics, spatial transcriptomics, single-cell epigenomics, 3D genomics, and spatial proteomics. It runs a workspace in your browser where the agent plans tasks, writes and runs code, drives experiments, queries scientific databases, and writes up results. Bring your own API key, use eligible ChatGPT/Codex access, or run a local model.

Part of the Axiomics monorepo.

## Run from source

From the repository root:

```bash
bun install
bun run setup
bun dev
```

`bun dev` opens the workspace in your browser. Every subcommand goes through it:

```bash
bun dev ~/code/project      # open it in a specific directory (the default)
bun dev run "..."           # run a one-shot task
bun dev serve               # start a headless server
bun dev sandbox             # inspect the shell confinement
```

To produce a standalone binary, run `bun run --cwd backend/cli build`.

On Linux, `bun dev` needs kernel 5.1 or newer for the bubblewrap sandbox. On Linux ARM64, Bun-compiled executables currently require a 4 KB kernel page size; 16 KB and 64 KB page kernels fail early with a clear diagnostic while [upstream support](https://github.com/oven-sh/bun/issues/17627) remains open.

Configuration lives in `~/.config/axiomics/axiomics.json`. Provider keys can be set in the workspace and remain on this device. Default, learned, installed, and project skills are local.

## Docs

See the [repository README](../../README.md) for the full layout, provider setup, and the agent and skill architecture.
