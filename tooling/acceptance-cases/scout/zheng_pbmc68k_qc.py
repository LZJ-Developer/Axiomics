from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import scanpy as sc


def main() -> None:
    parser = argparse.ArgumentParser(description="Blind metadata and QC scout for the 68k PBMC case")
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    data = sc.read_10x_mtx(args.matrix, var_names="gene_symbols", make_unique=True, cache=False)
    data.var["mt"] = data.var_names.str.upper().str.startswith("MT-")
    sc.pp.calculate_qc_metrics(data, qc_vars=["mt"], percent_top=[20, 50], log1p=True, inplace=True)

    cols = ["total_counts", "n_genes_by_counts", "pct_counts_mt", "pct_counts_in_top_20_genes"]
    data.obs[cols].to_csv(args.output / "cell_qc.csv")
    quantiles = [0, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 1]
    summary = {
        "cells": int(data.n_obs),
        "genes": int(data.n_vars),
        "matrixShape": [int(data.n_obs), int(data.n_vars)],
        "archiveSha256": hashlib.sha256(args.archive.read_bytes()).hexdigest(),
        "python": platform.python_version(),
        "scanpy": sc.__version__,
        "metrics": {
            col: {str(q): float(data.obs[col].quantile(q)) for q in quantiles}
            for col in cols
        },
    }
    (args.output / "qc_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    fig, axes = plt.subplots(2, 2, figsize=(12, 9), constrained_layout=True)
    plots = [
        ("n_genes_by_counts", "Detected genes per cell", 100),
        ("total_counts", "UMIs per cell", 100),
        ("pct_counts_mt", "Mitochondrial fraction (%)", 100),
        ("pct_counts_in_top_20_genes", "Counts in top 20 genes (%)", 100),
    ]
    for axis, (col, title, bins) in zip(axes.flat, plots, strict=True):
        values = data.obs[col].to_numpy()
        limit = np.quantile(values, 0.995)
        axis.hist(values[values <= limit], bins=bins, color="#2b6f77", alpha=0.9)
        axis.axvline(np.median(values), color="#d46b40", linewidth=2, label="median")
        axis.set(title=title, xlabel=col, ylabel="Cells")
        axis.legend(frameon=False)
    fig.suptitle("Fresh PBMC 68k · blind input QC", fontsize=17, fontweight="bold")
    fig.savefig(args.output / "qc_overview.png", dpi=180, facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    main()
