from pathlib import Path
import json
import numpy as np
import pandas as pd
import scanpy as sc
import anndata as ad
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.metrics import adjusted_rand_score
root=Path('/disk1/dabiao/axiomics-projects/_tracer/stamo/full')
results={}
fig,axes=plt.subplots(2,2,figsize=(12,10))
for i,(name,rep) in enumerate([('RNA','X_pca'),('H3K27ac','X_lsi')]):
 source=sc.read_h5ad(root/(name+'-prepared.h5ad'))
 obj=ad.AnnData(X=source.X if name=='RNA' else np.asarray(source.obsm['X_lsi']),obs=source.obs.copy())
 if name=='RNA':
  obj.var_names=source.var_names
  sc.tl.pca(obj,n_comps=50,random_state=42)
 else: obj.obsm['X_lsi']=source.obsm['X_lsi'].copy()
 obj.obsm['spatial']=source.obsm['spatial'].copy()
 sc.pp.neighbors(obj,use_rep=rep,n_neighbors=15,random_state=42)
 sc.tl.leiden(obj,resolution=1,random_state=42,key_added='cluster')
 sc.tl.umap(obj,random_state=42)
 categories=obj.obs.cluster.cat.codes.to_numpy()
 for ax,key in [(axes[i,0],'spatial'),(axes[i,1],'X_umap')]:
  coords=obj.obsm[key]
  ax.scatter(coords[:,0],coords[:,1],c=categories,s=3,cmap='tab20' if i==0 else 'Set3',rasterized=True)
  ax.set_title(name+' '+('spatial domains' if key=='spatial' else 'UMAP'))
  ax.set_aspect('equal');ax.set_xticks([]);ax.set_yticks([])
  if key=='spatial':ax.invert_yaxis()
 if name=='RNA':
  sc.tl.rank_genes_groups(obj,'cluster',method='wilcoxon')
  sc.get.rank_genes_groups_df(obj,group=None).to_csv(root/'rna-independent-markers.csv',index=False)
 obj.obs.to_csv(root/(name+'-independent-clusters.csv'))
 obj.write_h5ad(root/(name+'-baseline.h5ad'),compression='gzip')
 results[name]={'clusters':int(obj.obs.cluster.nunique()),'rows':obj.n_obs}
 del source,obj
rna=pd.read_csv(root/'RNA-independent-clusters.csv')
epi=pd.read_csv(root/'H3K27ac-independent-clusters.csv')
paired=rna.merge(epi,on='source_barcode',suffixes=('_RNA','_H3K27ac'))
results['independent_modality_ARI']=adjusted_rand_score(paired.cluster_RNA,paired.cluster_H3K27ac)
fig.suptitle('Independent modality baselines; cluster colors are not cross-modality labels')
fig.tight_layout()
fig.savefig(root/'independent-baselines.png',dpi=180)
(root/'baselines.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
