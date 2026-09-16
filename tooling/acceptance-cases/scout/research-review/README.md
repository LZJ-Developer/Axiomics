# Research completion review: offline tracer

This is an offline prototype, **not a production hook**. It creates independent,
read-only review sessions with no source-session history and no evaluation answer key.
It does not change the original answer, research permissions, or ordinary agent modes.

Run from repository root:

```sh
bun tooling/acceptance-cases/scout/research-review/run.ts evidence.json output-directory project-directory
```

The JSON bundle contains a draft, actual evidence, and optionally deterministic check
outputs. Documents are treated as evidence rather than instructions. Review files and
session IDs are saved in output-directory. Model review can be wrong; no verdict is a
certificate and no recommendation is automatically authorized by this prototype.

## 2026-09-14 experiment

Private data and responses remain outside the source repository:
`/disk1/dabiao/axiomics-projects/_tracer/scenic-review`.

- First review: identified unsupported animal-experiment recommendations, numeric
  inconsistencies and incomplete evidence; missed pathology heterogeneity and itself
  attributed an inconclusive result to low power without establishing that cause.
- Follow-up: added analysis scripts, remaining Results tables, patient-level group
  composition and a computed design-matrix rank. No DESIGN.md or scoring rubric supplied.
- Two nonbiological controls: identical before/after measurements; one draft reports only
  observed changes, the other asserts causality and universal deployment benefit.

The two controls returned `pass` for the bounded observation and `revise` for causal
  overreach. This is one run each, not a reliability estimate. The reviewer also added
  speculative explanations, so its findings still require evidence checking.

Before a production integration, verify both correction and pass behavior, decide how
  to expose draft/review state, and test cancellation, provider failure, and bounded repair.
The existing processor streams text before the loop sees `stop`: simply adding a callback
  after `processor.process()` would NOT prevent an unchecked answer being shown as final.
Do not claim a publication gate without addressing that lifecycle.

## Follow-up outcome

Fuller evidence review returned `revise`: it rejected immediate functional-experiment
recommendations and limited Lung contrasts because platform and site are inseparable.
It found reuse of the same patients across purported validation branches and several
report/table inconsistencies. These are review findings, not automatically verified facts.
The reviewer still failed to address supplied pathology heterogeneity and introduced an
unsupported universal cluster-count threshold (>=40). Do not promote that threshold into
platform policy or present this output verbatim as an authoritative review.

This call consumed 37,898 input tokens and 20,764 output tokens (18,283 reasoning)
according to provider usage. A complete evidence dump is too expensive for an automatic
per-turn hook. Next tracer should use targeted evidence retrieval and bound review effort,
then repeat controls before changing production final-answer handling.

The prototype is promising but not ready to become a mandatory scientific approval gate.
No live services were restarted and no source case report was changed.
