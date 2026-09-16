"""Official GLUE workflow with genomic guidance and reference-only label transfer."""
import argparse
from pathlib import Path
import itertools
import json
import time
import anndata as ad
import numpy as np
import pandas as pd
import scanpy as sc
import scglue
import networkx as nx
from sklearn.neighbors import KNeighborsClassifier

parser=argparse.ArgumentParser()
parser.add_argument('data',type=Path);parser.add_argument('output',type=Path)
parser.add_argument('--size',type=int);parser.add_argument('--epochs',type=int)
args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
start=time.monotonic()
rna=ad.read_h5ad(args.data/'rna_reference.h5ad');atac=ad.read_h5ad(args.data/'atac_peaks.h5ad')
if args.size:
 rna=rna[:args.size].copy();atac=atac[:args.size].copy()
scglue.data.get_gene_annotation(rna,gtf=str(args.data/'gencode.v32.annotation.gtf.gz'),gtf_by='gene_name')
rna=rna[:,rna.var.chrom.notna()].copy()
rna.layers['counts']=rna.X.copy()
sc.pp.highly_variable_genes(rna,n_top_genes=2000,flavor='seurat_v3',span=1.0 if args.size else 0.3)
sc.pp.normalize_total(rna);sc.pp.log1p(rna);sc.pp.scale(rna,max_value=10);sc.tl.pca(rna,n_comps=50,svd_solver='arpack')
scglue.data.lsi(atac,n_components=100,n_iter=15)
graph=scglue.genomics.rna_anchored_guidance_graph(rna,atac)
scglue.graph.check_graph(graph,[rna,atac])
scglue.models.configure_dataset(rna,'NB',use_highly_variable=True,use_layer='counts',use_rep='X_pca')
scglue.models.configure_dataset(atac,'NB',use_highly_variable=True,use_rep='X_lsi')
features=itertools.chain(rna.var.query('highly_variable').index,atac.var.query('highly_variable').index)
graph=graph.subgraph(features).copy()
fit={'directory':str(args.output/'training')}
if args.epochs:fit['max_epochs']=args.epochs
model=scglue.models.fit_SCGLUE({'rna':rna,'atac':atac},graph,fit_kws=fit,init_kws={'random_seed':0},skip_balance=bool(args.size))
model.save(args.output/'glue.dill')
x=model.encode_data('rna',rna);y=model.encode_data('atac',atac)
assert np.isfinite(x).all() and np.isfinite(y).all()
classifier=KNeighborsClassifier(n_neighbors=15,metric='cosine').fit(x,rna.obs.cell_type.astype(str))
pred=classifier.predict(y);probs=classifier.predict_proba(y)
pd.DataFrame({'cell':atac.obs_names,'GLUE':pred,'vote_fraction':probs.max(axis=1)}).to_csv(args.output/'predictions.csv',index=False)
np.savez_compressed(args.output/'embeddings.npz',rna=x,atac=y)
nx.write_graphml(graph,args.output/'guidance.graphml.gz')
(args.output/'run.json').write_text(json.dumps({'rna_cells':rna.n_obs,'atac_cells':atac.n_obs,'graph_nodes':len(graph),'graph_edges':graph.number_of_edges(),'seconds':time.monotonic()-start,'epochs_override':args.epochs,'query_labels_used':False},indent=2))
print((args.output/'run.json').read_text())
