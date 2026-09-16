# STAMO independent preflight

Upstream: https://github.com/zhanglabtools/STAMO at `700b4e680970e8e92be74ff376cbadfdd0ea2efe`.
The user approved dependency installation and performance fixes that preserve scientific intent.

## Library-size allocation fix

`library-size.patch` changes only the reduction in `utils.cross_predict`:

`sum_genes(mean_neighbors(counts)) = mean_neighbors(sum_genes(counts))`.

The original densifies the complete reference matrix and then creates a
query × 15 neighbors × genes tensor. The patch reduces the sparse matrix before
neighbor indexing. At the source comment's example dimensions (9548 × 15 × 19588),
it avoids a 10.45 GiB float32 neighbor tensor, plus the dense reference copy.
This is an allocation calculation, not a measured end-to-end speedup.

The patch keeps neighbor selection, model invocation and output handling unchanged.
Floating-point summation order changes; exact bitwise identity is not promised.

Apply in the external STAMO checkout with `git apply library-size.patch`.
Run the verification with a Python containing NumPy and SciPy:

```sh
python verify-library-size.py /path/to/STAMO
```

Verification extracts the actual original (`git show HEAD`) and patched function
reductions, avoiding a copied implementation. CSR, CSC, dense inputs, repeated
neighbors, zero counts and int32/int64/float32/float64 passed with rtol=2e-6,
atol=1e-6. Maximum observed float32 absolute difference: 3.052e-5.
The same short-trained real model subsequently passed original/patched prediction comparison (see below).

## Environment preflight (2026-09-13)

- Isolated root: `/disk1/dabiao/axiomics-envs/omics-stamo-1.0.0`.
- bedtools 2.30.0 official static Linux binary installed and `--version` passed.
- PyTorch 2.7.1/cu128 installed; RTX 5090 forward/backward passed.
- STAMO/PyG imports, GPU backward, real bedtools intersection and `pip check` passed.
- Real-data short training and checkpoint restoration passed; capability registration completed.
- Existing seven frozen environments and running platform services were not modified.
- External checkout, download staging and logs: `/disk1/dabiao/axiomics-projects/_tracer/stamo/`.

Original dependencies mostly retained. Python 3.11 requires a newer scikit-misc
wheel than the original 0.1.4; proposed 0.3.1 still supplies the same LOESS API.
NumPy 1.26.4 and AnnData 0.10.9 constrain compatibility with Scanpy 1.9.8.
Import checks and real-data short training passed. Infrastructure registration and sandboxed GPU execution have passed.

## Data preflight

Author files downloaded successfully (RNA 173,783,666 bytes, H3K27ac 281,616,738 bytes).
RNA: 9,370 × 23,415; H3K27ac: 9,370 × 125,158. All barcodes overlap and
matching barcodes have equal spatial coordinates. This is co-measured data.

`prepare.py SOURCE DESTINATION` reconstructs input objects from counts, feature
identities, pixel identities and spatial coordinates. It removes author clusters,
annotations, embeddings and color tables. Reopened outputs passed exact count,
identity and coordinate preservation checks. Clean inputs are in
`/disk1/dabiao/axiomics-projects/06-stamo/data/`.
The original objects remain outside the case project for independent evaluation.
GENCODE M25 annotation was downloaded from the official EBI release archive.

A bounded synthetic allocation probe (1500 reference rows, 8000 genes, 800
queries, 15 neighbors, float32, 3% sparse density) ran the actual reductions in
separate processes: original ~139 ms versus patched ~4.9 ms. `/proc/self/status`
VmHWM was ~500 MiB for the original and ~149 MiB for the patched process
(including fixture construction/imports); this is not full-model performance.
The standalone probe is retained under the external tracer's `validation/`.

## PyTorch scheduler compatibility

RTX 5090 CUDA forward/backward passed on torch 2.7.1+cu128. The original
`ReduceLROnPlateau(..., verbose=True)` call reproduced a TypeError on that version.
`torch-scheduler.patch` removes only the removed logging argument. STAMO's own
learning-rate-change logger remains; patience, monitored metric and update rule
are unchanged. The real training plugin, including checkpoint restoration, passed in the short real-data probe.


## Real-data execution result

`probe.py DATA SOURCE OUTPUT` performs the bounded 256-pixel probe using the
clean inputs and GENCODE M25: preprocessing, guidance graph, two pretrain epochs,
FGW transport, two fine-tune epochs, checkpoint restoration, embeddings and
cross-modal prediction. This is an execution check, not convergence or a scientific
conclusion. The model loss and transport algorithm retain upstream defaults.

Both modalities produced finite 256 × 50 embeddings. The same trained model's
original and patched cross-predictions (256 × 485) agreed with maximum absolute
error 3.5762787e-7, within rtol=2e-5 / atol=1e-5. Feature names and spatial arrays
matched exactly. The patch does not validate every other assumption in upstream
cross-prediction (for example, reference/source spatial correspondence).

Logs: external tracer `gpu-smoke.log`, `training-smoke.log`, `roundtrip.log`.
Installed versions: external tracer `requirements.lock`.
No formal Agent session or published gallery entry has been created yet.


## Platform integration (2026-09-13)

STAMO is registered as `stamo` / `omics-stamo-1.0.0`. The environment now
contains its own Python standard library and required native libraries, so the
sandbox needs only this runtime root. The initial venv's shared base stdlib failed
inside the sandbox; copying the executable alone was insufficient.

Local GPU manifests compile to GPU-aware jobs. Their sandbox receives NVIDIA
compute device nodes and read-only NVIDIA module/CPU-memory topology metadata.
Ordinary CPU jobs do not gain device access. File masks, immutable runtime mounts,
PID lifetime and network policy remain enforced. This enables local GPU access;
it is not a GPU scheduler or exclusive-device allocation mechanism.

Verified: 8/8 full doctor, sandboxed GPU smoke (`device=cuda`), actual task-profile
GPU forward/backward, 67 capability/sandbox tests plus 58 compute tests passed / 1 environment-dependent skip, CLI typecheck.
An old network test failed identically on the pre-change code; its assertion was
updated to the existing explicit allow/deny contract, without changing networking.
Backend restarted after checking no active sessions. HTTP health and Chrome gallery
(5 cases) / PBMC replay (550 frames) load checks passed.

Full-data scout is running outside the Agent project. Preparation preserved 9,370
pixels, selected 4,527 annotated RNA features and built a 26,272-node guidance
graph with 70,168 edges. The upstream default training ceiling is 183 epochs;
early stopping and learning-rate scheduling remain enabled. Serialization requires
storing `edgeList` as an array and re-running `configure_dataset` after reading
AnnData because its writer omits dictionary `None` values.

Formal project policy: network allowed for data, dependencies and method docs;
no reading/searching source-paper conclusions, author labels or tutorial answers.
Full access is scoped to this public-data project; Balanced independence is active.
Only infrastructure smokes deliberately deny network. The formal scientific user
prompt contains no environment activation paths or literature answers.


The provider tracer used the actual Axiomics CLI with
`deepseek/deepseek-v4-flash-vision-exp`; it returned a normal final response with
`reason=stop`. This diagnostic session is outside the formal analysis project.
The browser replay was also seeked to frame 550 and rendered the PDF; after a
reload there were no alert notifications.

Full pretraining stopped naturally and restored epoch 63. Upstream FGW anchor
matching samples 5000 pixels per modality with seed 42; this does not remove the
remaining pixels from the subsequent full-data embedding/training outputs.


## OT CPU/GPU verification (2026-09-13, prototype only)

STAMO explicitly chooses NumpyBackend for FGW; neural-network CUDA use does not
move the separate solver to CUDA. The running registered environment is unchanged.
`pot-linesearch.patch` reassociates two repeated-row products in POT 0.9.5, from
`dot(outer(ones,q),F)` to `outer(ones,dot(q,F))`. This preserves the mathematical
operation but can change floating-point summation order.

`verify-ot-real.py` regenerates embeddings from the actual pretrain checkpoint and
compares the original/optimized CPU solver, using default convergence settings.
Three real-data tests (256×320, 512×512, 1024×900; seeds 42/17/101) had identical
transport matrices and anchors, with 21–22% shorter single-run times.

`verify-ot-gpu.py` compares CPU and CUDA with the same algebraic optimization and
float64 inputs. 512-point times: 0.617/0.261 s; 1024-point: 3.409/0.154 s.
Matching matrices were identical in these tests. These are single trials during
concurrent training, not a robust platform-wide speed claim.

`verify-ot-gpu-full.py` repeats the actual 5,000-per-modality sampling (seed 42),
using cached real pretrain embeddings. Optimized CUDA float64 converged in 20
iterations in 18.574 s, including host/device transfers and returning the matrix,
but excluding distance construction and input loading. Comparison against the
original full CPU run's saved CSV: max absolute transport difference 0,
anchor agreement 100%. Final objective 0.7197205442072622. GPU 0 memory observed
around 4.5 GB; existing fine-tuning continued independently on GPU 3.
No precise full-run CPU speed ratio is claimed because the original phase was
not separately timed. CPU model deserialization requires the original CUDA device
indices to remain visible; do not restrict CUDA_VISIBLE_DEVICES to a single index
when reloading this checkpoint saved on cuda:3.

The scripts patch the imported function only within their diagnostic process;
they do not modify site-packages. Deployment remains pending completion of the
active training run, versioned STAMO backend selection, environment reattestation,
and the normal full doctor/GPU smoke. Keep a CPU fallback and float64, without
changing anchor counts, tolerances, or iteration limits.
