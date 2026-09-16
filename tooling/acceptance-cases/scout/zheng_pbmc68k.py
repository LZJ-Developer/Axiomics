from __future__ import annotations

import argparse
import json
from importlib.metadata import version
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scanpy as sc
from sklearn.metrics import adjusted_rand_score


def genes(data: sc.AnnData, names: list[str]) -> list[str]:
    return [name for name in names if name in data.var_names]


def main() -> None:
    parser = argparse.ArgumentParser(description="Blind scout analysis for the fresh 68k PBMC case")
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    sc.settings.seed = 20260906
    sc.settings.figdir = args.output
    data = sc.read_10x_mtx(args.matrix, var_names="gene_symbols", make_unique=True, cache=False)
    data.var["mt"] = data.var_names.str.upper().str.startswith("MT-")
    sc.pp.calculate_qc_metrics(data, qc_vars=["mt"], percent_top=[20], log1p=True, inplace=True)
    before = data.n_obs
    keep = (
        (data.obs["n_genes_by_counts"] >= 200)
        & (data.obs["n_genes_by_counts"] <= 1500)
        & (data.obs["total_counts"] <= 5000)
        & (data.obs["pct_counts_mt"] < 5)
    )
    data = data[keep].copy()
    sc.pp.filter_genes(data, min_cells=3)
    data.layers["counts"] = data.X.copy()
    sc.pp.normalize_total(data, target_sum=10_000)
    sc.pp.log1p(data)
    data.raw = data
    sc.pp.highly_variable_genes(data, n_top_genes=3_000, flavor="cell_ranger")

    core = data[:, data.var["highly_variable"]].copy()
    sc.pp.scale(core, max_value=10)
    sc.tl.pca(core, n_comps=50, svd_solver="arpack", random_state=20260906)
    sc.pp.neighbors(core, n_neighbors=15, n_pcs=40, random_state=20260906)
    for resolution in [0.5, 0.8, 1.1]:
        sc.tl.leiden(
            core,
            resolution=resolution,
            key_added=f"leiden_{resolution}",
            random_state=20260906,
            flavor="igraph",
            n_iterations=2,
            directed=False,
        )
    sc.tl.umap(core, random_state=20260906, min_dist=0.35)

    data.obs[["leiden_0.5", "leiden_0.8", "leiden_1.1"]] = core.obs[
        ["leiden_0.5", "leiden_0.8", "leiden_1.1"]
    ]
    data.obs["cluster"] = data.obs["leiden_0.8"].copy()
    data.obsm["X_pca"] = core.obsm["X_pca"]
    data.obsm["X_umap"] = core.obsm["X_umap"]
    data.obsp["connectivities"] = core.obsp["connectivities"]
    data.obsp["distances"] = core.obsp["distances"]
    data.uns["neighbors"] = core.uns["neighbors"]

    sc.tl.rank_genes_groups(data, "cluster", method="wilcoxon", pts=True, use_raw=True)
    groups = list(data.obs["cluster"].cat.categories)
    markers = pd.concat(
        [sc.get.rank_genes_groups_df(data, group=group).head(30).assign(cluster=group) for group in groups],
        ignore_index=True,
    )
    markers.to_csv(args.output / "cluster_markers.csv", index=False)

    modules = {
        "T cell": ["CD3D", "CD3E", "TRAC", "LTB"],
        "Cytotoxic lymphocyte": ["NKG7", "GNLY", "CCL5", "KLRD1"],
        "B cell": ["MS4A1", "CD79A", "CD74", "HLA-DRA"],
        "CD14 monocyte": ["LYZ", "S100A8", "S100A9", "CTSD"],
        "FCGR3A monocyte": ["FCGR3A", "LST1", "IFITM3", "LGALS3"],
        "Dendritic cell": ["FCER1A", "CST3", "CD1C", "HLA-DPA1"],
        "Platelet": ["PPBP", "PF4", "NRGN", "GNG11"],
    }
    for label, names in modules.items():
        present = genes(data, names)
        if len(present) >= 2:
            sc.tl.score_genes(data, present, score_name=f"score:{label}", random_state=20260906)
    scores = [col for col in data.obs if col.startswith("score:")]
    cluster_scores = data.obs.groupby("cluster", observed=True)[scores].mean()
    cluster_labels = cluster_scores.idxmax(axis=1).str.removeprefix("score:").to_dict()
    data.obs["broad_type"] = data.obs["cluster"].map(cluster_labels).astype("category")

    summary = (
        data.obs.groupby(["cluster", "broad_type"], observed=True)
        .agg(
            cells=("cluster", "size"),
            median_umis=("total_counts", "median"),
            median_genes=("n_genes_by_counts", "median"),
            median_mt_pct=("pct_counts_mt", "median"),
        )
        .reset_index()
        .sort_values("cells", ascending=False)
    )
    summary["fraction"] = summary["cells"] / data.n_obs
    summary.to_csv(args.output / "cluster_summary.csv", index=False)
    cluster_scores.to_csv(args.output / "cluster_module_scores.csv")

    stability = {
        "ari_0.5_vs_0.8": adjusted_rand_score(data.obs["leiden_0.5"], data.obs["leiden_0.8"]),
        "ari_0.8_vs_1.1": adjusted_rand_score(data.obs["leiden_0.8"], data.obs["leiden_1.1"]),
        "ari_0.5_vs_1.1": adjusted_rand_score(data.obs["leiden_0.5"], data.obs["leiden_1.1"]),
    }
    report = {
        "seed": 20260906,
        "cellsBeforeQc": before,
        "cellsAfterQc": data.n_obs,
        "genesAfterQc": data.n_vars,
        "removedCells": before - data.n_obs,
        "resolutions": [0.5, 0.8, 1.1],
        "selectedResolution": 0.8,
        "clusters": len(groups),
        "stability": stability,
        "versions": {
            name: version(name)
            for name in ["scanpy", "anndata", "numpy", "pandas", "scikit-learn", "igraph", "leidenalg"]
        },
    }
    (args.output / "analysis_summary.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    palette = [
        "#22577A",
        "#38A3A5",
        "#57CC99",
        "#80ED99",
        "#F4A261",
        "#E76F51",
        "#8E6C88",
        "#6D597A",
        "#457B9D",
        "#E9C46A",
        "#BC6C25",
        "#5F6F52",
        "#9B5DE5",
        "#00BBF9",
        "#F15BB5",
    ]
    sc.pl.umap(
        data,
        color=["cluster", "broad_type"],
        palette=palette,
        frameon=False,
        wspace=0.28,
        show=False,
    )
    plt.gcf().set_size_inches(14, 6)
    plt.gcf().suptitle("Fresh PBMC 68k · data-driven cell landscape", fontsize=17, fontweight="bold")
    plt.savefig(args.output / "pbmc68k_atlas.png", dpi=200, bbox_inches="tight", facecolor="white")
    plt.close()

    panel = list(dict.fromkeys(name for names in modules.values() for name in genes(data, names)))
    sc.pl.dotplot(
        data,
        panel,
        groupby="cluster",
        standard_scale="var",
        use_raw=True,
        show=False,
        return_fig=False,
    )
    plt.gcf().set_size_inches(16, 7)
    plt.savefig(args.output / "pbmc68k_marker_dotplot.png", dpi=200, bbox_inches="tight", facecolor="white")
    plt.close()

    sc.pl.umap(
        data,
        color=genes(data, ["CD3D", "NKG7", "MS4A1", "LYZ", "FCGR3A", "FCER1A", "PPBP"]),
        ncols=4,
        frameon=False,
        color_map="magma",
        show=False,
    )
    plt.gcf().set_size_inches(15, 11)
    plt.savefig(args.output / "pbmc68k_marker_panels.png", dpi=180, bbox_inches="tight", facecolor="white")
    plt.close()

    data.write_h5ad(args.output / "pbmc68k_annotated.h5ad", compression="gzip")


if __name__ == "__main__":
    main()
