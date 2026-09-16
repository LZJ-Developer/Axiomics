import { CapabilityManifest, type CapabilityRuntime, type CapabilitySource } from "../schema"
import { CORE_SMOKES, type CoreSmokeID } from "../smokes"

type OmicsID = Extract<
  CoreSmokeID,
  | "scanpy"
  | "squidpy"
  | "snapatac2"
  | "open2c"
  | "archr"
  | "hicpro"
  | "mcmicro"
  | "stamo"
  | "camus"
  | "stamapper"
  | "scvi"
>

function toolchain(input: {
  id: OmicsID
  name: string
  summary: string
  source: CapabilitySource
  runtime: Extract<CapabilityRuntime, { kind: "managed_toolchain" }>
}) {
  return CapabilityManifest.parse({
    schema_version: 2,
    id: input.id,
    version: "1.0.0",
    name: input.name,
    category: "bioinformatics",
    summary: input.summary,
    maturity: "experimental",
    availability: { local: "setup_needed", hosted: "not_applicable" },
    basis:
      "Axiomics binds this workflow to an administrator-provisioned, machine-wide immutable toolchain. Every local dispatch reattests the registered root and entrypoint, mounts it read-only, injects runtime variables, and records the manifest lock in provenance. Research tasks may retrieve public references over the network; bounded release canaries remain offline.",
    source: input.source,
    runtime: input.runtime,
    smoke: CORE_SMOKES[input.id],
    setup: {
      instructions:
        "Provision the pinned shared toolchain once through infrastructure, then register its root and receipt. Research Agents use scientific_capability and must not create a replacement environment.",
      requirements: ["Linux x86-64", "Administrator-provisioned shared runtime outside project workspaces"],
    },
  })
}

const base = {
  kind: "managed_toolchain" as const,
  targets: ["local"] as ("local" | "modal")[],
  local_platforms: ["linux-x64"] as "linux-x64"[],
  workspace_cache: {},
  network: { build: "administrator" as const, execution: "unrestricted" as const },
}

export const omicsManifests = {
  stamapper: toolchain({
    id: "stamapper",
    name: "STAMapper spatial annotation",
    summary:
      "Annotate spatial expression using an RNA reference with the STAMapper Python API. Labels are required only for the reference. GPU training is supported; NumPy plotting fixes preserve the method.",
    source: {
      kind: "github",
      name: "STAMapper spatial annotation",
      version: "0.0.2",
      reference: "https://github.com/zhanglabtools/STAMapper/tree/28e06050e18340235dbd46929f8155411c2982a6",
      license: "MIT",
    },
    runtime: {
      ...base,
      pack_id: "omics-stamapper-0.0.2",
      lock_digest: "ebf8bc2853eee7c01503979711986df44e1865ea999867d1ac56ab0d602a3659",
      entrypoint: "bin/python",
      path_entries: ["bin"],
      environment: {
        LD_LIBRARY_PATH: "lib",
      },
      workspace_cache: {
        NUMBA_CACHE_DIR: ".axiomics/cache/numba",
        MPLCONFIGDIR: ".axiomics/cache/matplotlib",
        XDG_CACHE_HOME: ".axiomics/cache/xdg",
      },
      attestations: [
        {
          path: "requirements.lock",
          sha256: "ebf8bc2853eee7c01503979711986df44e1865ea999867d1ac56ab0d602a3659",
        },
        {
          path: "stamapper-array-comparison.patch",
          sha256: "5b36612dee6450220cad504da6299a22be1493f26a22ad7b9095ec7739fcbfcc",
        },
        {
          path: "stamapper-numpy-int.patch",
          sha256: "d6f8d652187b009de118447c78c596981b5e02dbdb42a4792b4c22b5954c6390",
        },
      ],
      components: {
        python: "3.11.16",
        stamapper: "0.0.2",
        torch: "2.7.1+cu128",
      },
      resources: {
        cpus: 16,
        memory_gb: 128,
        time_minutes: 720,
        gpu: "local",
      },
    },
  }),
  scvi: toolchain({
    id: "scvi",
    name: "scVI / scANVI",
    summary:
      "Train SCVI and SCANVI using the installed Python API on local GPU. Use batch labels and an explicit unlabeled category for query cells; record whether inputs are counts or transformed expression.",
    source: {
      kind: "github",
      name: "scVI / scANVI",
      version: "1.3.3",
      reference: "https://github.com/scverse/scvi-tools/tree/1.3.3",
      license: "BSD-3-Clause",
    },
    runtime: {
      ...base,
      pack_id: "omics-scvi-1.3.3",
      lock_digest: "77ef95cd990b8f5c1265f66f3700393145f4d858df8b32c2e6ccc0a56535fdf8",
      entrypoint: "bin/python",
      path_entries: ["bin"],
      environment: {
        LD_LIBRARY_PATH: "lib",
      },
      workspace_cache: {
        NUMBA_CACHE_DIR: ".axiomics/cache/numba",
        MPLCONFIGDIR: ".axiomics/cache/matplotlib",
        XDG_CACHE_HOME: ".axiomics/cache/xdg",
      },
      attestations: [
        {
          path: "requirements.lock",
          sha256: "77ef95cd990b8f5c1265f66f3700393145f4d858df8b32c2e6ccc0a56535fdf8",
        },
      ],
      components: {
        python: "3.11.16",
        scvi: "1.3.3",
        torch: "2.7.1+cu128",
      },
      resources: {
        cpus: 16,
        memory_gb: 128,
        time_minutes: 720,
        gpu: "local",
      },
    },
  }),

  camus: toolchain({
    id: "camus",
    name: "CAMUS cross-omics annotation",
    summary:
      "Compare RNA-to-ATAC annotations using CAMUS, GLUE and scJoint on a shared GPU runtime. CAMUS scores rank methods, not per-cell probabilities. scJoint source is installed under sys.prefix/share/scjoint; copy its config and source to work before running the upstream CLI. Use reference labels only; retain uncertain subtypes for review.",
    source: {
      kind: "github",
      name: "zhanglabtools/CAMUS",
      version: "1.0.1",
      reference: "https://github.com/zhanglabtools/CAMUS/tree/0f2c52fdb745f799941aa316abd86f08a3106629",
      license: "MIT",
    },
    runtime: {
      ...base,
      pack_id: "omics-camus-1.0.1",
      lock_digest: "d003576f6b46cbda3308a5552f49626e5662f1a5f0b31caa0c1f059121bf1ed4",
      entrypoint: "bin/python",
      path_entries: ["bin"],
      environment: { LD_LIBRARY_PATH: "lib" },
      workspace_cache: {
        NUMBA_CACHE_DIR: ".axiomics/cache/numba",
        MPLCONFIGDIR: ".axiomics/cache/matplotlib",
        XDG_CACHE_HOME: ".axiomics/cache/xdg",
      },
      attestations: [
        { path: "camus-requirements.lock", sha256: "d003576f6b46cbda3308a5552f49626e5662f1a5f0b31caa0c1f059121bf1ed4" },
      ],
      components: {
        python: "3.11.16",
        camus: "1.0.1",
        scglue: "0.4.0",
        snapatac2: "2.6.4",
        torch: "2.7.1+cu128",
        scjoint: "cbbfa5d7e7faa35f3d725bd5257507a01a22810f",
      },
      resources: { cpus: 16, memory_gb: 64, time_minutes: 720, gpu: "local" },
    },
  }),
  stamo: toolchain({
    id: "stamo",
    name: "STAMO",
    summary:
      "Spatial RNA–epigenome integration, spatial domains and cross-modal prediction using STAMO. Use the installed Python API; local NVIDIA GPU execution is supported.",
    source: {
      kind: "github",
      name: "zhanglabtools/STAMO",
      version: "1.0.0",
      reference: "https://github.com/zhanglabtools/STAMO/tree/700b4e680970e8e92be74ff376cbadfdd0ea2efe",
      license: "MIT",
    },
    runtime: {
      ...base,
      pack_id: "omics-stamo-1.0.0",
      lock_digest: "221a4203bd2c17550a720153609d38d02c70ba63ec9b9cbbf0ca76f6bad4509f",
      entrypoint: "bin/python",
      path_entries: ["bin"],
      environment: {},
      workspace_cache: {
        NUMBA_CACHE_DIR: ".axiomics/cache/numba",
        MPLCONFIGDIR: ".axiomics/cache/matplotlib",
        XDG_CACHE_HOME: ".axiomics/cache/xdg",
      },
      attestations: [
        { path: "stamo-requirements.lock", sha256: "221a4203bd2c17550a720153609d38d02c70ba63ec9b9cbbf0ca76f6bad4509f" },
      ],
      components: {
        python: "3.11.16",
        stamo: "1.0.0",
        torch: "2.7.1+cu128",
        pyg: "2.6.1",
        bedtools: "2.30.0",
        source_commit: "700b4e680970e8e92be74ff376cbadfdd0ea2efe",
        patches_sha256: "debdf1b2e5b2319acc8551b86e10a06430c49b3c2fa69c0b0055e658c51fb7af",
      },
      resources: { cpus: 32, memory_gb: 128, time_minutes: 720, gpu: "local" },
    },
  }),
  scanpy: toolchain({
    id: "scanpy",
    name: "Scanpy",
    summary:
      "End-to-end single-cell transcriptomics preprocessing, quality control, embedding, clustering, and differential analysis.",
    source: {
      kind: "pypi",
      name: "scanpy",
      version: "1.11.4",
      reference: "https://pypi.org/project/scanpy/1.11.4/",
      license: "BSD-3-Clause",
    },
    runtime: {
      ...base,
      pack_id: "omics-scanpy-1.11.4",
      lock_digest: "78f28fafde188dddc8d696f8e28e687dd71ed3e135a002d3dd9b351b2767dc23",
      entrypoint: "bin/python",
      path_entries: ["bin"],
      environment: { CONDA_PREFIX: "." },
      workspace_cache: {
        NUMBA_CACHE_DIR: ".axiomics/cache/numba",
        MPLCONFIGDIR: ".axiomics/cache/matplotlib",
        XDG_CACHE_HOME: ".axiomics/cache/xdg",
      },
      attestations: [
        {
          path: "axiomics-requirements.lock",
          sha256: "cc016928ae2adb1b948b2f8efe9d4a425c0f3b1a05baad0c2362c9363537f081",
        },
      ],
      components: {
        python: "3.11.16",
        scanpy: "1.11.4",
        requirements_sha256: "cc016928ae2adb1b948b2f8efe9d4a425c0f3b1a05baad0c2362c9363537f081",
      },
      resources: { cpus: 32, memory_gb: 128, time_minutes: 720, gpu: "none" },
    },
  }),
  squidpy: toolchain({
    id: "squidpy",
    name: "Squidpy",
    summary: "Spatial transcriptomics image, neighborhood, spatial graph, enrichment, and ligand-receptor analysis.",
    source: {
      kind: "pypi",
      name: "squidpy",
      version: "1.8.3",
      reference: "https://pypi.org/project/squidpy/1.8.3/",
      license: "BSD-3-Clause",
    },
    runtime: {
      ...base,
      pack_id: "omics-squidpy-1.8.3",
      lock_digest: "d827a1b833d0da14b3aeaba63e42c9ff0242e270381c1fcc21fe1eb7687d0a85",
      entrypoint: "bin/python",
      path_entries: ["bin"],
      environment: { CONDA_PREFIX: "." },
      workspace_cache: {
        NUMBA_CACHE_DIR: ".axiomics/cache/numba",
        MPLCONFIGDIR: ".axiomics/cache/matplotlib",
        XDG_CACHE_HOME: ".axiomics/cache/xdg",
      },
      attestations: [
        {
          path: "axiomics-requirements.lock",
          sha256: "6e0ab8dca8efb4bcb440c7a436d9214e2fbf5dcbaddb62fee179e1ad531b4b5a",
        },
      ],
      components: {
        python: "3.12.14",
        scanpy: "1.12.4",
        squidpy: "1.8.3",
        requirements_sha256: "6e0ab8dca8efb4bcb440c7a436d9214e2fbf5dcbaddb62fee179e1ad531b4b5a",
      },
      resources: { cpus: 32, memory_gb: 128, time_minutes: 720, gpu: "none" },
    },
  }),
  snapatac2: toolchain({
    id: "snapatac2",
    name: "SnapATAC2",
    summary:
      "Python and Rust workflow for scalable single-cell chromatin accessibility QC, feature selection, embedding, clustering, peak, motif, and regulatory analysis.",
    source: {
      kind: "pypi",
      name: "snapatac2",
      version: "2.10.0",
      reference: "https://pypi.org/project/snapatac2/2.10.0/",
      license: "MIT",
    },
    runtime: {
      ...base,
      pack_id: "omics-snapatac2-2.10.0",
      lock_digest: "39a366eb09f1459daccb20c2f05af8045f58be27b5e7a8357cec598765be9d1a",
      entrypoint: "bin/python",
      path_entries: ["bin"],
      environment: { CONDA_PREFIX: "." },
      workspace_cache: {
        NUMBA_CACHE_DIR: ".axiomics/cache/numba",
        MPLCONFIGDIR: ".axiomics/cache/matplotlib",
        XDG_CACHE_HOME: ".axiomics/cache/xdg",
      },
      attestations: [
        {
          path: "axiomics-explicit-lock.txt",
          sha256: "39a366eb09f1459daccb20c2f05af8045f58be27b5e7a8357cec598765be9d1a",
        },
      ],
      components: {
        python: "3.12.14",
        snapatac2: "2.10.0",
        umap: "0.5.12",
        macs3: "3.0.4",
        anndata: "0.13.3.post0",
        environment_sha256: "39a366eb09f1459daccb20c2f05af8045f58be27b5e7a8357cec598765be9d1a",
      },
      resources: { cpus: 48, memory_gb: 256, time_minutes: 1440, gpu: "none" },
    },
  }),
  open2c: toolchain({
    id: "open2c",
    name: "Open2C Hi-C",
    summary:
      "Composable Hi-C workflow using pairtools, cooler, and cooltools for pairs processing, contact matrices, expected contacts, compartments, and insulation boundaries.",
    source: {
      kind: "github",
      name: "open2c/pairtools",
      version: "1.1.3",
      reference: "https://github.com/open2c/pairtools/tree/v1.1.3",
      license: "MIT",
    },
    runtime: {
      ...base,
      pack_id: "omics-open2c-1.1.3",
      lock_digest: "10115fc31cc3c3ba7210c156295474906443cbf663e0c7a0139676b2c6314854",
      entrypoint: "bin/python",
      path_entries: ["bin"],
      environment: { CONDA_PREFIX: "." },
      workspace_cache: {
        MPLCONFIGDIR: ".axiomics/cache/matplotlib",
        XDG_CACHE_HOME: ".axiomics/cache/xdg",
      },
      attestations: [
        {
          path: "axiomics-explicit-lock.txt",
          sha256: "10115fc31cc3c3ba7210c156295474906443cbf663e0c7a0139676b2c6314854",
        },
      ],
      components: {
        python: "3.12.14",
        pairtools: "1.1.3",
        cooler: "0.10.4",
        cooltools: "0.7.1",
        bwa: "0.7.19",
        samtools: "1.22.1",
        environment_sha256: "10115fc31cc3c3ba7210c156295474906443cbf663e0c7a0139676b2c6314854",
      },
      resources: { cpus: 64, memory_gb: 256, time_minutes: 1440, gpu: "none" },
    },
  }),
  archr: toolchain({
    id: "archr",
    name: "ArchR",
    summary:
      "Single-cell chromatin accessibility quality control, dimensionality reduction, peak, motif, and gene-score analysis.",
    source: {
      kind: "github",
      name: "GreenleafLab/ArchR",
      version: "1.0.3",
      reference: "https://github.com/GreenleafLab/ArchR/tree/v1.0.3",
      license: "MIT",
    },
    runtime: {
      ...base,
      pack_id: "omics-archr-1.0.3",
      lock_digest: "74c1104921969fc3749733cb97288fb36d5bde190a009f7d268a65fe260eaf02",
      entrypoint: "bin/Rscript",
      path_entries: ["bin"],
      environment: { CONDA_PREFIX: ".", R_HOME: "lib/R" },
      workspace_cache: { XDG_CACHE_HOME: ".axiomics/cache/xdg" },
      attestations: [
        {
          path: "axiomics-explicit-lock.txt",
          sha256: "74c1104921969fc3749733cb97288fb36d5bde190a009f7d268a65fe260eaf02",
        },
      ],
      components: {
        r: "4.4.3",
        archr: "1.0.3",
        bioconductor: "3.20",
        harmony: "2.0.5",
        macs2: "2.2.9.1",
        environment_sha256: "74c1104921969fc3749733cb97288fb36d5bde190a009f7d268a65fe260eaf02",
      },
      resources: { cpus: 48, memory_gb: 256, time_minutes: 1440, gpu: "none" },
    },
  }),
  hicpro: toolchain({
    id: "hicpro",
    name: "HiC-Pro",
    summary: "Hi-C read mapping, filtering, valid-pair construction, contact maps, and matrix normalization.",
    source: {
      kind: "github",
      name: "nservant/HiC-Pro",
      version: "3.1.0",
      reference: "https://github.com/nservant/HiC-Pro/tree/v3.1.0",
      license: "GPL-3.0",
    },
    runtime: {
      ...base,
      pack_id: "omics-hicpro-3.1.0",
      lock_digest: "3d300e51875bc3e244383a9dc99ade3cffcbcb740ec5d05aaf73e86899b4b64a",
      entrypoint: "HiC-Pro_3.1.0/bin/HiC-Pro",
      path_entries: ["HiC-Pro_3.1.0/bin", "bin"],
      environment: { CONDA_PREFIX: "." },
      attestations: [
        {
          path: "axiomics-environment.lock.yml",
          sha256: "2b7e5b56a9359e1849776a66a0136c3123d238a2377f3ee1e6d55bd73944fbba",
        },
        {
          path: "axiomics-source-commit.txt",
          sha256: "606c9c2ff57a927296635dbad6ed25335920ce3b3d3fa6d786556e0c28b34823",
        },
      ],
      components: {
        hicpro: "3.1.0",
        hicpro_commit: "de77ff9cc9dd927989e661f74454aeac24a61791",
        bowtie2: "2.4.4",
        samtools: "1.12",
        environment_sha256: "2b7e5b56a9359e1849776a66a0136c3123d238a2377f3ee1e6d55bd73944fbba",
      },
      resources: { cpus: 64, memory_gb: 256, time_minutes: 1440, gpu: "none" },
    },
  }),
  mcmicro: toolchain({
    id: "mcmicro",
    name: "MCMICRO",
    summary:
      "Nextflow workflow for registration, segmentation, quantification, and downstream processing of highly multiplexed tissue images.",
    source: {
      kind: "github",
      name: "nf-core/mcmicro",
      version: "f4400001578642e370a72668966c6602fe172ef6",
      reference: "https://github.com/nf-core/mcmicro/tree/f4400001578642e370a72668966c6602fe172ef6",
      license: "MIT",
    },
    runtime: {
      ...base,
      pack_id: "omics-mcmicro-f440000",
      lock_digest: "7032cbd6c3aadd3871d2cce6406ac541e1c02f274926bfb6d84548b5623c63e7",
      entrypoint: "bin/nextflow",
      path_entries: ["bin"],
      environment: { CONDA_PREFIX: ".", JAVA_HOME: "lib/jvm", MCMICRO_HOME: "workflow" },
      workspace_cache: { NXF_HOME: ".axiomics/cache/nextflow" },
      attestations: [
        {
          path: "axiomics-environment.lock.txt",
          sha256: "6ca981efbc0b7103ad2bc50a288225a573c9579e6cdf36070895dd266f14b5b6",
        },
        {
          path: "axiomics-source-commit.txt",
          sha256: "971fcc4fa71a24b24f15e0807f7bb27a6ff79dde5622818d8f4735d480beb7b6",
        },
      ],
      components: {
        mcmicro: "f4400001578642e370a72668966c6602fe172ef6",
        nextflow: "25.04.8",
        java: "17.0.18",
        environment_sha256: "6ca981efbc0b7103ad2bc50a288225a573c9579e6cdf36070895dd266f14b5b6",
        workflow_sha256: "9ad6580632e17b04fd1b72585c4c4529248318137e54fe55821ee0b1c98d2682",
      },
      resources: { cpus: 64, memory_gb: 256, time_minutes: 1440, gpu: "none" },
    },
  }),
} as const
