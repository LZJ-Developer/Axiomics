from pathlib import Path
import json

import anndata as ad
import numpy as np
from PIL import Image


def main() -> None:
    root = Path(__file__).resolve().parents[4]
    source = root / "acceptance-lab/datasets/maynard-dlpfc/source/DLPFC_151673.h5ad"
    target = root / "acceptance-lab/projects/02-maynard-dlpfc/input/dlpfc_section_A.h5ad"
    image = target.with_name("tissue_hires.png")
    metadata = target.with_name("metadata.json")

    data = ad.read_h5ad(source)
    data.obs = data.obs.drop(columns=["cluster"])

    spatial = data.uns["spatial"].pop("151673")
    data.uns["spatial"]["DLPFC-A"] = spatial
    data.uns["dataset"] = {
        "sample_alias": "DLPFC-A",
        "species": "Homo sapiens",
        "tissue": "dorsolateral prefrontal cortex",
        "condition": "neurologically healthy adult donor",
        "platform": "10x Genomics Visium",
    }

    target.parent.mkdir(parents=True, exist_ok=True)
    data.write_h5ad(target, compression="gzip")
    saved = ad.read_h5ad(target, backed="r")
    if saved.X is None or saved.shape != data.shape:
        raise RuntimeError("Prepared AnnData lost its primary expression matrix")

    pixels = np.asarray(spatial["images"]["hires"])
    scaled = np.clip(pixels * 255 if pixels.max() <= 1 else pixels, 0, 255).astype(np.uint8)
    Image.fromarray(scaled).save(image)
    metadata.write_text(
        json.dumps(
            {
                "sample": "DLPFC-A",
                "species": "Homo sapiens",
                "tissue": "dorsolateral prefrontal cortex",
                "condition": "neurologically healthy adult donor",
                "platform": "10x Genomics Visium",
                "matrix": "raw integer gene-count matrix",
                "question": "Does the section contain stable spatial domains, and what molecular programs distinguish them?",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print(f"prepared {data.n_obs} spots x {data.n_vars} genes")


if __name__ == "__main__":
    main()
