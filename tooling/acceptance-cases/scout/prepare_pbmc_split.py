from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import scanpy as sc


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare anonymized PBMC discovery and holdout count matrices")
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--discovery", type=Path, required=True)
    parser.add_argument("--holdout", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    args.discovery.parent.mkdir(parents=True, exist_ok=True)
    args.holdout.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)

    data = sc.read_10x_mtx(args.matrix, var_names="gene_symbols", make_unique=True, cache=False)
    order = np.random.default_rng(20260906).permutation(data.n_obs)
    discovery = data[order[:60_000]].copy()
    holdout = data[order[60_000:]].copy()
    discovery.obs_names = [f"cell_{index:05d}" for index in range(discovery.n_obs)]
    holdout.obs_names = [f"holdout_{index:05d}" for index in range(holdout.n_obs)]
    discovery.write_h5ad(args.discovery, compression="gzip")
    holdout.write_h5ad(args.holdout, compression="gzip")

    manifest = {
        "seed": 20260906,
        "selection": "uniform random split without labels or QC filtering",
        "sourceCells": int(data.n_obs),
        "genes": int(data.n_vars),
        "discoveryCells": int(discovery.n_obs),
        "holdoutCells": int(holdout.n_obs),
        "sourceArchiveSha256": digest(args.archive),
        "discoverySha256": digest(args.discovery),
        "holdoutSha256": digest(args.holdout),
    }
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
