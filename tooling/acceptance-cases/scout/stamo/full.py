"""Independent full-data scout. No author labels enter preprocessing or training."""
from pathlib import Path
import argparse,json,time
import numpy as np
import scanpy as sc
import anndata as ad
import networkx as nx
import STAMO

parser=argparse.ArgumentParser()
parser.add_argument('phase',choices=['prepare','train','analyze'])
args=parser.parse_args()
root=Path('/disk1/dabiao/axiomics-projects/_tracer/stamo/full')
root.mkdir(exist_ok=True)
data=Path('/disk1/dabiao/axiomics-projects/06-stamo/data')
start=time.time()
if args.phase=='prepare':
 rna=sc.read_h5ad(data/'P22_H3K27ac_RNA.h5ad')
 epi=sc.read_h5ad(data/'P22_H3K27ac_cuttag.h5ad')
 for obj in (rna,epi):
  obj.obs['source_barcode']=obj.obs_names
  obj.obs['total_counts']=np.asarray(obj.X.sum(axis=1)).ravel()
  obj.obs['n_features']=(obj.X>0).sum(axis=1).A1
  assert (obj.obs.total_counts>0).all()
  obj.layers['counts']=obj.X.copy()
  assert set(obj.obsm)=={'spatial'} and not obj.uns
 rna.obs.to_csv(root/'rna-qc.csv')
 epi.obs.to_csv(root/'h3k27ac-qc.csv')
 sc.pp.highly_variable_genes(rna,n_top_genes=5000,flavor='seurat_v3')
 sc.pp.normalize_total(rna)
 sc.pp.log1p(rna)
 rna=rna[:,rna.var.highly_variable].copy()
 rna.obsm['X_feat']=rna.X.toarray()
 print('RNA normalization complete',rna.shape,flush=True)
 epi.obsm['X_lsi']=np.load(root/'lsi.npy') if (root/'lsi.npy').exists() else STAMO.utils.Epigenome_preprocess([epi.copy()])
 np.save(root/'lsi.npy',epi.obsm['X_lsi'])
 print('Epigenome LSI complete',epi.shape,flush=True)
 STAMO.data.get_gene_annotation(rna,gtf=data/'gencode.vM25.chr_patch_hapl_scaff.annotation.gtf.gz',gtf_by='gene_name')
 rna=rna[:,rna.var.chrom.notna()].copy()
 parts=epi.var_names.str.split('-')
 epi.var['chrom']=parts.map(lambda x:x[0])
 epi.var['chromStart']=parts.map(lambda x:int(x[1]))
 epi.var['chromEnd']=parts.map(lambda x:int(x[2]))
 graph=STAMO.genomics.rna_anchored_guidance_graph(rna,epi,propagate_highly_variable=True)
 graph=graph.subgraph(list(rna.var_names[rna.var.highly_variable])+list(epi.var_names[epi.var.highly_variable])).copy()
 for name,obj,rep in [('RNA',rna,'X_feat'),('H3K27ac',epi,'X_lsi')]:
  obj.obs_names=obj.obs_names+'_'+name
  STAMO.utils.Cal_Spatial_Net(obj,rad_cutoff=1.3)
  obj.uns['edgeList']=np.asarray(obj.uns['edgeList'])
  STAMO.models.configure_dataset(obj,'NB',use_rep=rep,use_layer='counts',use_obs_names=True)
  obj.write_h5ad(root/(name+'-prepared.h5ad'),compression='gzip')
 nx.write_graphml(graph,root/'guidance.graphml.gz')
 (root/'preparation.json').write_text(json.dumps({'rna_shape':rna.shape,'epigenome_shape':epi.shape,'graph_nodes':len(graph),'graph_edges':graph.number_of_edges(),'seconds':time.time()-start,'author_labels_used':False},indent=2))
 print('PREPARATION COMPLETE',flush=True)
if args.phase=='train':
 rna=sc.read_h5ad(root/'RNA-prepared.h5ad')
 epi=sc.read_h5ad(root/'H3K27ac-prepared.h5ad')
 graph=nx.read_graphml(root/'guidance.graphml.gz')
 for obj,rep in [(rna,'X_feat'),(epi,'X_lsi')]:
  obj.uns.pop(STAMO.utils.config.ANNDATA_KEY,None)
  STAMO.models.configure_dataset(obj,'NB',use_rep=rep,use_layer='counts',use_obs_names=True)
 model=STAMO.models.train({'RNA':rna,'H3K27ac':epi},graph,fit_kws={'directory':str(root/'model')},OT_pair=[('RNA','H3K27ac')])
 for name,obj in [('RNA',rna),('H3K27ac',epi)]:
  obj.obsm['X_STAMO']=model.encode_data_minibatch(name,obj)
  assert np.isfinite(obj.obsm['X_STAMO']).all()
  obj.write_h5ad(root/(name+'-integrated.h5ad'),compression='gzip')
 (root/'training.json').write_text(json.dumps({'seconds':time.time()-start,'rna_rows':rna.n_obs,'epigenome_rows':epi.n_obs,'finite_embeddings':True,'fit':'upstream default convergence settings'},indent=2))
 print('TRAINING COMPLETE',flush=True)
