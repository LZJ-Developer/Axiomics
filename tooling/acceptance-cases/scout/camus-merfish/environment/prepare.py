from pathlib import Path
import anndata as ad
import numpy as np
import json
root=Path('/disk1/dabiao/axiomics-projects/_tracer/camus-merfish')
out=root/'environment'/'data'
out.mkdir(exist_ok=True)
rng=np.random.default_rng(20260913)
ref=ad.read_h5ad(root/'input-check/hypothalamic_sc.h5ad')
query=ad.read_h5ad(root/'input-check/MERFISH_hypothalamic_8.h5ad')
# Balance the reference only. Query selection does not inspect its labels.
idx=np.sort(np.concatenate([rng.choice(np.flatnonzero(ref.obs.celltype==label),32,replace=False) for label in sorted(ref.obs.celltype.unique())]))
ref=ref[idx].copy()
query=query[np.sort(rng.choice(query.n_obs,512,replace=False))].copy()
query.obs=query.obs.drop(columns=['celltype'])
assert ref.obs_names.is_unique and query.obs_names.is_unique
ref.write_h5ad(out/'reference.h5ad')
query.write_h5ad(out/'query.h5ad')
summary={'seed':20260913,'reference':list(ref.shape),'query':list(query.shape),'query_labels_removed':True,'reference_types':ref.obs.celltype.value_counts().to_dict(),'purpose':'Compatibility only; not accuracy evaluation'}
(out/'summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary))
