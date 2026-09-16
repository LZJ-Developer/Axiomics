# Archived CAMUS PBMC preflight

Scientific story: the same immune cells receive different names from different
RNA-to-ATAC annotation methods. Locate disagreements, inspect biological evidence,
and distinguish accepted labels from cases needing review.

## Inputs and evaluation

Author PBMC.zip contains 9,631 cells in both Reference.h5ad (RNA counts) and
query.h5ad (60,606 gene-activity features, not genomic peaks). All RNA counts
exactly match official cell-arc/1.0.0/pbmc_granulocyte_sorted_10k, across all
29,095 shared genes. Official matrix supplies 108,377 ATAC peaks.

prepare.py uses a seeded permutation (20260913), independent of query labels,
to split cells into 4,815 RNA references and 4,816 ATAC queries. Both disjoint
sets retain input counts unchanged. Query labels stay in external scout storage.
These are same-donor held-out cells, not an independent-donor benchmark. Author
labels serve as an evaluation reference, not experimental ground truth.

Inputs are in /disk1/dabiao/axiomics-projects/07-camus/data. Downloads, held-out
labels and independent results stay under /disk1/dabiao/axiomics-projects/_tracer/camus.

## Execution

Independent CAMUS runtime is registered at
/disk1/dabiao/axiomics-envs/omics-camus-1.0.1. No existing runtime is modified.

scjoint.py runs upstream stage 1, KNN, stage 3, KNN. Full runs retain the 10x
configuration's 20 epochs per stage. Compatibility patch replaces removed
np.float with identical float dtype and obtains terminal width with a non-TTY
fallback. Training objectives are unchanged. Upstream `_knn_probs` are not
calibrated probabilities and are not used as per-cell reliability estimates.

A 256-reference/256-query, two-epoch-per-stage real-data smoke passed GPU training
and prediction. This is an execution test, not a scientific performance result.

GLUE uses official genomic-guidance workflow, default fit/early stopping, and
15-neighbor cosine label transfer from reference cells. Query labels never enter
training or method ranking. Precomputed author method labels are not used.

Formal session ses_f655d0740ffeAzBj1V0pSyFaW6 completed three turns and a report; it is retained for internal review, not published. The active case is now camus-merfish (Figure 4B).


## Platform verification

CAMUS 1.0.1, GLUE 0.4.0, SnapATAC2 2.6.4, AutoGluon tabular 1.1.0,
and torch 2.7.1/cu128 installed; pip check passed. scJoint source is pinned to
cbbfa5d7e7faa35f3d725bd5257507a01a22810f with the compatibility patch above.
Platform supplies the runtime's lib directory through its validated managed
LD_LIBRARY_PATH. This fixes the native SQLite/ICU C++ ABI dependency without
requiring an Agent to activate environments or change import order.

9/9 full doctor checks report ready. Actual bubblewrap CAMUS canary passed GPU
backward, GLUE imports and CAMUS score, then released its job. 76 targeted
registry/toolchain/compute/canary tests and backend typecheck passed. Backend
was restarted only after its active-session status was empty; Chrome confirms
six gallery cards and the 512-frame STAMO replay/PDF still load.

scJoint full independent run: all 4,816 query cells, 20 epochs per stage,
20,169 common gene features, 54.46 seconds for training and prediction (excludes
input preparation). GLUE 256+256 probe passed in 38.46 seconds. Its bounded
probe uses LOESS span 1.0 and skips balancing because two epochs do not provide
stable balancing estimates; full analysis uses span 0.3, ordinary balancing,
and default early stopping. Probe results are not scientific conclusions.

Cleanup: old raw download copies and small probe outputs were removed after supersession; full-run evidence and formal project inputs remain. Re-download raw sources before rerunning prepare.py. See external scout README for download IDs.
