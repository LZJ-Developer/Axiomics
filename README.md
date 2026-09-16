<div align="center">

<img src="assets/wordmark.svg" alt="Axiomics" width="440">

### 支持五类组学分析的全流程科研智能体

> **Axiomics** 把大模型规划、可复现代码执行、生物信息数据库和分析工具整合进同一个科研工作区。
> 给它一个研究目标，它自己走完从读文献、写代码、跑实验到写报告的完整闭环。

**单细胞转录组 · 空间转录组 · 单细胞表观组 · 三维基因组 · 空间蛋白组**

<br/>

[Quickstart](#quickstart) · [What it does](#what-it-does) · [Configuration](#configuration)

</div>

---

Axiomics is an AI workbench for bioinformatics research. You give it a goal — *"which immune cell types are in this blood sample, and how many of each?"* — and it works the problem the way a careful collaborator would: it reads the papers that matter, forms a hypothesis, writes and runs the analysis code, runs the experiment on your compute, queries scientific databases, keeps the provenance, and writes up what it found.

It runs as a workspace in your browser, and it is model-agnostic: use frontier models with your own provider keys, or point it at local models.

## What it does

### Five omics, end to end

Each one has a real analysis pipeline behind it, not a demo script — a fixed toolchain, pinned environments, and a recorded end-to-end run you can replay frame by frame.

| Omics                       | Toolchain                                     |
| --------------------------- | --------------------------------------------- |
| Single-cell transcriptomics | Scanpy                                        |
| Spatial transcriptomics     | Squidpy + SpatialData                         |
| Single-cell epigenomics     | SnapATAC2                                     |
| 3D genomics                 | Open2C — pairtools, cooler, cooltools         |
| Spatial proteomics          | MCMICRO + Scanpy / Squidpy                    |

### And the loop around them

- **Runs the whole loop.** Literature review, hypothesis, code, experiment, analysis, and write-up, in one continuous session.
- **One adaptive Research agent.** A single user-facing collaborator handles the task end to end, loads domain skills when useful, and delegates independent Explore or Execute work when it helps. Off, Auto, and High delegation guide how readily it parallelizes without imposing a per-turn worker quota; plan mode stays read-only.
- **251 bundled skills.** Training (DeepSpeed, PEFT, TRL), evaluation, dataset work, single-cell and molecular biology, papers and LaTeX, figures, and user-configured scientific runtimes.
- **Scientific databases as tools.** 42 built-in connectors, including UniProt, PDB, Ensembl, ChEMBL, PubChem, arXiv, OpenAlex, and Semantic Scholar, queryable directly by the agent.
- **Governed scientific capabilities.** A truthful 54-entry inventory sits behind one lifecycle tool. Five experimental Python capabilities run through exact, hashed local or Modal environments; ten experimental BioNeMo capabilities use strict bring-your-own-key NVIDIA NIM adapters. No capability is labeled verified until a release-artifact canary passes.
- **A real workspace.** A browser UI with a file tree, an editor, a terminal, session history, and inline rendering for molecules, structures, genomes, and plots.
- **Recorded, replayable runs.** Any session can be replayed frame by frame — a shell invocation and its result stay one step — so a result can be shown the same way twice.
- **Extensible.** LSP integration, MCP servers, plugins, custom agents and commands, and a TypeScript SDK. Five reviewed connector presets help configure common MCP endpoints, but they save disabled for inspection and do not claim ELN, LIMS, clinical, or regulatory write-back.

## Quickstart

Build the workspace from source ([Bun](https://bun.sh) 1.3.14 and Node 18 or newer):

```bash
bun install
bun run setup
```

Set an API key from a supported provider (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, and so on) and start the workspace:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun dev
```

`bun dev` opens the workspace in your browser. Your keys stay on your machine and requests go straight to the provider. You can also add keys from the Credentials panel and pick a model from the model selector. To open the workspace in a specific project:

```bash
bun dev ~/code/my-project
```

Every `axiomics` command from [the CLI](#the-cli) is available the same way — `bun dev <command>`.

## How it works

Axiomics runs a local server that hosts the workspace UI, the agent runtime, the complete default skill library, and the tool layer. The agent plans with a research harness, calls tools (shell, editor, LSP, MCP servers, scientific connectors, and skills), and streams its work back to the browser. Models are routed per request directly to providers you configure, so you can switch between providers or run local models without changing anything else. Sessions, settings, credentials, skills, artifacts, and provenance are stored on disk.

| Path                 | Contents                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| `backend/cli`        | The CLI, server, provider integrations, sessions, connectors, and skills |
| `frontend/workspace` | The browser workspace UI, served by the CLI                              |
| `frontend/ui`        | Shared UI components and themes                                          |
| `frontend/docs`      | The documentation site                                                   |
| `tooling/sdk/js`     | The TypeScript SDK                                                       |
| `tooling/plugin`     | The plugin runtime                                                       |
| `tooling/repo`       | Contributor setup, SDK regeneration, and repo scripts                    |
| `tracer`             | The recorded-session replay tracer                                       |
| `evals`              | Launch evals and the research-harness dev lab                            |

## The CLI

Running from a checkout, every subcommand goes through `bun dev`:

```bash
bun dev --help              # list every command
bun dev ~/code/my-project   # open the workspace in a project (the default)
bun dev run "..."           # send one prompt, stream the result, and exit
bun dev serve               # start a headless server
bun dev sandbox             # inspect the shell confinement
bun dev sandbox test        # verify it actually confines
```

## Configuration

Global config lives in `~/.config/axiomics/axiomics.json`. Project config lives in `axiomics.json` or a `.axiomics/` directory at the repo root. Custom agents, commands, tools, plugins, and themes load from those directories.

## Development

You need [Bun](https://bun.sh) 1.3.14 (the `packageManager` pin) and Node 18 or newer.

```bash
bun run setup                      # verify Bun, install dependencies, embed the workspace UI
bun dev                            # open the workspace from source
bun run check                      # format, typecheck, and unit tests (the local gates)
bun run --cwd backend/cli build    # build the CLI binary
```

`bun run setup` builds the workspace UI once so `bun dev` can serve it; rerun it with `--web` after UI changes.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the system fits together and [AGENTS.md](AGENTS.md) for the style guide.

## Security

The permission system keeps you aware of what the agent is doing; it is not an isolation boundary by itself. New projects start in **Ask risky**: contained, reversible work proceeds, while external, costly, or hard-to-reverse actions wait for you. Commands run inside macOS Seatbelt or Linux bubblewrap containment, with no network. The composer's **Research tools → Action approval** menu can switch to **Ask always** (every action waits, and project trust is revoked) or deliberately enable **Full access** (trusted project, containment off). An administrator policy may enforce a stricter boundary. The sandbox is not a full jail, so use a container or VM for hostile code. Provider credentials stay out of general subprocess environments, arbitrary Python/R kernels receive a minimal environment, and credential-shaped values are redacted from output. To inspect or verify containment, run `bun dev sandbox` and `bun dev sandbox test`; to report a vulnerability, see [SECURITY.md](SECURITY.md).
