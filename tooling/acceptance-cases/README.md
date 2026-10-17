# Axiomics acceptance cases

This directory defines the reproducible inputs and verification contracts for
the five public-data acceptance stories. Runtime projects live in the
deployment's project root, shared toolchains under `$AX_SHARED_ENVS`, and
platform state under `~/.config/axiomics/data-root/`. Large inputs,
intermediate outputs, and PDFs stay outside the platform source repository.

Each case is developed as a vertical tracer bullet:

1. anchor the question, known conclusion, and evidence types in the primary paper;
2. complete the analysis independently and freeze the input, environment, and verification contract;
3. run the same question through the Axiomics research agent;
4. compare the agent Results with the contract and the literature baseline;
5. assess additional signals, competing explanations, and a falsifiable wet-lab validation plan;
6. curate the passing session into the cross-project case gallery.

The replay is always backed by a real Axiomics session. The catalog may select
a successful run, but playback preserves that session's saved messages and
execution records without deletion, rewriting, merging, or reordering. Speed
controls and seeking compress presentation time without inventing tool results
or scientific claims.

**One recorded exception, and only one.** The transcript — messages and their
parts — is never touched. But the records that bind a session to a _machine_
(`project.worktree`, `session_workspace.scratchRoot`, `session_filesystem.directory`
and its `grants[]`) name paths that existed on the machine that produced the case.
Those fields are rewritten to the destination container's convention
(`/data/projects/<prj>`, `/data/workspaces/<prj>/<sid>`) when the case slice is
seeded into a tenant — see `seed-cases` in `tooling/multitenant/bin/axiomics-tenant`.
Without it the UI reports `Folder unavailable` / `SessionFilesystemDeniedError`,
because the path simply does not exist there. The rewrite changes environment
bindings only; no message, part, ordering, or tool result is altered.

The gallery presents the current analysis and its scientific effect. Paper
comparisons are supporting evidence in the report. Every report ends with what
agrees with the paper, what differs and why, what additional information the
agent found, and how that candidate finding should be validated experimentally.

## Case run policy

Acceptance runs use project-scoped **Full access** with **Balanced**
independence. Configure both in the workspace before sending the first prompt;
they are execution settings and must not be smuggled into the user's scientific
request.

- Full access removes routine execution approval pauses for the curated case
  project. Use it only for the controlled projects listed in `catalog.json`.
- Balanced independence resolves routine planning choices with the recommended
  reversible option and records the assumption. It asks the user only when a
  direction choice can materially change the scientific scope or outcome.
- Apply the decision rule `P(wrong) * cost(rework) > cost(clarification)` at
  direction changes. If the inequality does not hold, run the smallest
  reversible check and update the evidence instead of interrupting the user.
- A `missing_authority` pause is an infrastructure defect during an acceptance
  run. Repair the runtime and resume the same session so the failure and
  recovery remain visible in replay; do not turn it into a scripted scientific
  conversation.

Full access currently disables the project execution sandbox. The acceptance
projects therefore contain only reviewed public data and case-local tools.
Ordinary projects retain their own access setting and the product default.
