"""Small real-data execution probe, not a scientific result or gallery case."""
from pathlib import Path
import argparse
import numpy as np
import scanpy as sc
import STAMO
import torch

parser=argparse.ArgumentParser()
parser.add_argument('data',type=Path)
parser.add_argument('source',type=Path)
parser.add_argument('output',type=Path)
args=parser.parse_args()
root=args.output
data=args.data
rna=sc.read_h5ad(data/'P22_H3K27ac_RNA.h5ad')
epi=sc.read_h5ad(data/'P22_H3K27ac_cuttag.h5ad')
# One contiguous coordinate block retains spatial neighbors in a small execution probe.
order=np.lexsort((rna.obsm['spatial'][:,1],rna.obsm['spatial'][:,0]))[:256]
rna=rna[order].copy()
epi=epi[order].copy()
sc.pp.filter_genes(rna,min_cells=3)
sc.pp.filter_genes(epi,min_cells=3)
rna=rna[:,np.argsort(np.asarray(rna.X.sum(axis=0)).ravel())[-512:]].copy()
epi=epi[:,np.argsort(np.asarray(epi.X.sum(axis=0)).ravel())[-2048:]].copy()
STAMO.data.get_gene_annotation(rna,gtf=data/'gencode.vM25.chr_patch_hapl_scaff.annotation.gtf.gz',gtf_by='gene_name')
rna=rna[:,rna.var.chrom.notna()].copy()
parts=epi.var_names.str.split('-')
epi.var['chrom']=parts.map(lambda x:x[0])
epi.var['chromStart']=parts.map(lambda x:int(x[1]))
epi.var['chromEnd']=parts.map(lambda x:int(x[2]))
for obj in (rna,epi):
 obj.layers['counts']=obj.X.copy()
 obj.var['highly_variable']=True
rna.obs_names=rna.obs_names+'_RNA'
epi.obs_names=epi.obs_names+'_H3K27ac'
sc.pp.normalize_total(rna)
sc.pp.log1p(rna)
rna.obsm['X_feat']=rna.X.toarray()
epi.obsm['X_lsi']=STAMO.utils.Epigenome_preprocess([epi.copy()])
graph=STAMO.genomics.rna_anchored_guidance_graph(rna,epi,propagate_highly_variable=True)
for obj,rep in ((rna,'X_feat'),(epi,'X_lsi')):
 STAMO.utils.Cal_Spatial_Net(obj,rad_cutoff=1.3)
 STAMO.models.configure_dataset(obj,'NB',use_rep=rep,use_layer='counts',use_obs_names=True)
print('PREPARED',rna.shape,epi.shape,graph.number_of_edges(),flush=True)
model=STAMO.models.train({'RNA':rna,'H3K27ac':epi},graph,fit_kws={'directory':str(root/'training-roundtrip'),'max_epochs':2,'wait_n_lrs':0,'align_burnin':0,'safe_burnin':False},OT_pair=[('RNA','H3K27ac')])
for name,obj in (('RNA',rna),('H3K27ac',epi)):
 embedding=model.encode_data_minibatch(name,obj)
 obj.obsm['X_STAMO']=embedding
 assert embedding.shape[0]==obj.n_obs and np.isfinite(embedding).all()
 print(name,embedding.shape,flush=True)
print('PASS: real-data preprocessing, pretrain, OT, fine-tune, embedding; not converged scientific analysis',flush=True)

import ast
import subprocess
original=subprocess.check_output(['git','show','HEAD:STAMO/utils.py'],cwd=args.source,text=True)
function=next(node for node in ast.parse(original).body if isinstance(node,ast.FunctionDef) and node.name=='cross_predict')
scope=dict(vars(STAMO.utils))
exec(compile(ast.Module(body=[function],type_ignores=[]),'<upstream-cross-predict>','exec'),scope)
np.random.seed(42)
torch.manual_seed(42)
before=scope['cross_predict'](epi,rna,model,graph)
np.random.seed(42)
torch.manual_seed(42)
after=STAMO.utils.cross_predict(epi,rna,model,graph)
np.testing.assert_allclose(after.X.toarray(),before.X.toarray(),rtol=2e-5,atol=1e-5)
assert after.var_names.equals(before.var_names)
np.testing.assert_array_equal(after.obsm['spatial'],before.obsm['spatial'])
print('PASS actual model cross-prediction equivalence',after.shape,'max_abs_error',abs(after.X-before.X).max(),flush=True)
