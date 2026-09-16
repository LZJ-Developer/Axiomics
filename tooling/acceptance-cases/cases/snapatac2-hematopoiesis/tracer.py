from pathlib import Path
import json

import snapatac2 as snap

HG19 = {
    "chr1": 249250621,
    "chr2": 243199373,
    "chr3": 198022430,
    "chr4": 191154276,
    "chr5": 180915260,
    "chr6": 171115067,
    "chr7": 159138663,
    "chr8": 146364022,
    "chr9": 141213431,
    "chr10": 135534747,
    "chr11": 135006516,
    "chr12": 133851895,
    "chr13": 115169878,
    "chr14": 107349540,
    "chr15": 102531392,
    "chr16": 90354753,
    "chr17": 81195210,
    "chr18": 78077248,
    "chr19": 59128983,
    "chr20": 63025520,
    "chr21": 48129895,
    "chr22": 51304566,
    "chrX": 155270560,
    "chrY": 59373566,
    "chrM": 16571,
}


def main():
    root = Path(__file__).resolve().parent
    source = root / "tracer" / "PBMCSmall.tsv.gz"
    output = root / "tracer" / "pbmc-small.h5ad"
    data = snap.pp.import_fragments(
        source,
        chrom_sizes=HG19,
        file=output,
        min_num_fragments=20,
        sorted_by_barcode=False,
    )
    snap.pp.add_tile_matrix(data, bin_size=5000)
    snap.pp.select_features(data, n_features=min(10_000, data.n_vars))
    snap.tl.spectral(data, n_comps=10)
    result = {
        "schema_version": 1,
        "snapatac2": snap.__version__,
        "cells": data.n_obs,
        "tiles": data.n_vars,
        "selected": int(data.var["selected"].sum()),
        "spectral_shape": list(data.obsm["X_spectral"].shape),
        "ok": data.n_obs > 0 and data.n_vars > 0,
    }
    (root / "tracer" / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
