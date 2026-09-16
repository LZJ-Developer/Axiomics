"""Prepare disjoint RNA reference and ATAC query; answers stay in scout storage."""
import json
import sys
from pathlib import Path
import anndata as ad
import numpy as np
import pandas as pd
import scanpy as sc

source, destination = map(Path, sys.argv[1:3])
destination.mkdir(parents=True, exist_ok=True)
rna = ad.read_h5ad(source / 'Reference.h5ad')
activity = ad.read_h5ad(source / 'query.h5ad')
raw = sc.read_10x_h5(source / '10x_multiome.h5', gex_only=False)
raw.var_names_make_unique()
assert rna.obs_names.equals(activity.obs_names)
assert (rna.obs.cell_type.astype(str).values == activity.obs.celltype.astype(str).values).all()
assert rna.obs_names.is_unique and activity.var_names.is_unique
counts = raw[rna.obs_names, rna.var_names].X
assert (counts - rna.X).nnz == 0, 'Author RNA must match official counts exactly'
# Split by seeded barcode permutation, never by query answers.
order = np.random.default_rng(20260913).permutation(rna.n_obs)
reference = rna.obs_names[order[:rna.n_obs // 2]]
query = rna.obs_names[order[rna.n_obs // 2:]]
assert not len(reference.intersection(query))
r = ad.AnnData(rna[reference].X.copy(), obs=pd.DataFrame({'cell_type':rna.obs.loc[reference,'cell_type'].values},index=reference), var=rna.var.copy())
g = ad.AnnData(activity[query].X.copy(),obs=activity.obs.loc[query,['n_fragment','frac_dup','frac_mito','tsse']].copy(),var=pd.DataFrame(index=activity.var_names))
p = raw[query,raw.var.feature_types == 'Peaks'].copy()
peaks = p.var_names.str.extract(r'^(.*):(\d+)-(\d+)$')
assert not peaks.isna().any().any()
p = ad.AnnData(p.X.copy(),obs=g.obs.copy(),var=pd.DataFrame({'chrom':peaks[0].values,'chromStart':peaks[1].astype(int).values,'chromEnd':peaks[2].astype(int).values},index=p.var_names))
for name,a in [('rna_reference',r),('atac_gene_activity',g),('atac_peaks',p)]:
 a.write_h5ad(destination / (name+'.h5ad'),compression='gzip')
 check=ad.read_h5ad(destination / (name+'.h5ad'))
 assert check.obs_names.equals(a.obs_names) and (check.X-a.X).nnz==0
 assert not any(k in check.obs for k in ['celltype','GLUE','scJoint'])
activity.obs.loc[query,['celltype']].to_csv(source/'heldout-labels.csv')
summary={'seed':20260913,'reference':len(reference),'query':len(query),'overlap':0,'reference_labels':r.obs.cell_type.value_counts().to_dict(),'official_rna_counts_equal':True,'atac_features':p.n_vars,'activity_features':g.n_vars,'source':'CAMUS PBMC.zip + 10x cell-arc/1.0.0/pbmc_granulocyte_sorted_10k','evaluation':'Author labels; same-donor held-out cells, not independent experimental ground truth'}
(source/'input-audit.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
