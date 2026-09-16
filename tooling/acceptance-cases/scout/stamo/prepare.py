"""Build count-only STAMO inputs; keep author annotations outside the case project."""
import argparse
from pathlib import Path
import anndata as ad
import numpy as np
import pandas as pd

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path)
args = parser.parse_args()
args.destination.mkdir(parents=True, exist_ok=True)
for suffix in ('RNA', 'cuttag'):
    name = f'P22_H3K27ac_{suffix}.h5ad'
    original = ad.read_h5ad(args.source / name)
    clean = ad.AnnData(
        X=original.X.copy(),
        obs=pd.DataFrame(index=original.obs_names.copy()),
        var=pd.DataFrame(index=original.var_names.copy()),
        obsm={'spatial': original.obsm['spatial'].copy()},
    )
    target = args.destination / name
    if target.exists():
        raise FileExistsError(target)
    clean.write_h5ad(target, compression='gzip')
    loaded = ad.read_h5ad(target)
    assert loaded.shape == original.shape
    assert loaded.obs_names.equals(original.obs_names)
    assert loaded.var_names.equals(original.var_names)
    assert (loaded.X != original.X).nnz == 0
    np.testing.assert_array_equal(loaded.obsm['spatial'], original.obsm['spatial'])
    assert not len(loaded.obs.columns) and not len(loaded.var.columns)
    assert set(loaded.obsm) == {'spatial'} and not loaded.uns and not loaded.layers
    print(name, loaded.shape, 'PASS: counts/identities/coordinates preserved, author results removed', flush=True)
