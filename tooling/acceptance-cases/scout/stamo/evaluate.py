"""Independent post-training checks. Author labels are used only here, after fitting."""
from pathlib import Path
import json
import numpy as np
import pandas as pd
import scanpy as sc
import anndata as ad
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.metrics import adjusted_rand_score,normalized_mutual_info_score
from sklearn.neighbors import NearestNeighbors
root=Path('/disk1/dabiao/axiomics-projects/_tracer/stamo/full')
rna=sc.read_h5ad(root/'RNA-integrated.h5ad')
epi=sc.read_h5ad(root/'H3K27ac-integrated.h5ad')
obs=pd.concat([rna.obs.assign(modality='RNA'),epi.obs.assign(modality='H3K27ac')])
obs.index=obs.modality.astype(str)+':'+obs.source_barcode.astype(str)
joint=ad.AnnData(X=np.vstack([rna.obsm['X_STAMO'],epi.obsm['X_STAMO']]),obs=obs)
joint.obsm['spatial']=np.vstack([rna.obsm['spatial'],epi.obsm['spatial']])
sc.pp.neighbors(joint,n_neighbors=15,use_rep='X',random_state=42)
sc.tl.leiden(joint,resolution=1,key_added='domain',random_state=42)
sc.tl.umap(joint,random_state=42)
left=joint.obs[joint.obs.modality=='RNA'].set_index('source_barcode')
right=joint.obs[joint.obs.modality=='H3K27ac'].set_index('source_barcode').loc[left.index]
result={'rows_per_modality':len(left),'joint_domains':int(joint.obs.domain.nunique()),'same_pixel_domain_agreement':float((left.domain.astype(str)==right.domain.astype(str)).mean()),'joint_modality_ARI':adjusted_rand_score(left.domain,right.domain),'independent_baseline':json.loads((root/'baselines.json').read_text()),'limitations':['Single co-measured slice; pixels are not independent biological replicates.','Shared spatial coordinates contribute information; this is not independently sampled slices.','Cross-modal agreement can be induced by alignment and is not alone proof of biological accuracy.']}
lookup=NearestNeighbors(n_neighbors=10).fit(epi.obsm['X_STAMO'])
_,idx=lookup.kneighbors(rna.obsm['X_STAMO'])
barcodes=epi.obs.source_barcode.to_numpy()
result['same_pixel_retrieval_top1']=float((barcodes[idx[:,0]]==rna.obs.source_barcode.to_numpy()).mean())
result['same_pixel_retrieval_top10']=float((barcodes[idx]==rna.obs.source_barcode.to_numpy()[:,None]).any(axis=1).mean())
truth=ad.read_h5ad(root.parent/'data/P22_H3K27ac_RNA.h5ad',backed='r')
reference=truth.obs.reindex(left.index)
result['posthoc_author_annotation_ARI']={}
for modality,labels in [('RNA',left),('H3K27ac',right)]:
 baseline=pd.read_csv(root/(modality+'-independent-clusters.csv')).set_index('source_barcode').loc[left.index]
 for column in ['annotation','RNA_clusters','H3K27ac_clusters']:
  valid=reference[column].notna()
  result['posthoc_author_annotation_ARI'][modality+':'+column]={'independent':adjusted_rand_score(reference.loc[valid,column].astype(str),baseline.loc[valid,'cluster'].astype(str)),'joint':adjusted_rand_score(reference.loc[valid,column].astype(str),labels.loc[valid,'domain'].astype(str))}
truth.file.close()
rna.obs['joint_domain']=left.loc[rna.obs.source_barcode,'domain'].astype(str).to_numpy()
sc.tl.rank_genes_groups(rna,'joint_domain',method='wilcoxon')
markers=sc.get.rank_genes_groups_df(rna,group=None)
markers.to_csv(root/'joint-rna-markers.csv',index=False)
pd.crosstab(left.domain,right.domain).to_csv(root/'cross-modal-domain-table.csv')
joint.obs.to_csv(root/'joint-domains.csv')
joint.write_h5ad(root/'joint-embedding.h5ad',compression='gzip')
fig,axes=plt.subplots(1,3,figsize=(16,5))
colors=joint.obs.domain.cat.codes.to_numpy()
for i,modality in enumerate(['RNA','H3K27ac']):
 mask=joint.obs.modality==modality
 xy=joint.obsm['spatial'][mask]
 axes[i].scatter(xy[:,0],xy[:,1],c=colors[mask],s=4,cmap='tab20',vmin=0,vmax=joint.obs.domain.nunique()-1,rasterized=True)
 axes[i].set_title(modality+' joint spatial domains');axes[i].invert_yaxis();axes[i].set_aspect('equal')
xy=joint.obsm['X_umap']
axes[2].scatter(xy[:,0],xy[:,1],c=colors,s=2,cmap='tab20',rasterized=True)
axes[2].set_title('Joint embedding')
for ax in axes:ax.set_xticks([]);ax.set_yticks([])
fig.tight_layout();fig.savefig(root/'joint-domains.png',dpi=180)
(root/'evaluation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
