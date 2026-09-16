"""Run upstream scJoint's three stages on disjoint real reference/query cells."""
import argparse
import os
from pathlib import Path
import sys
import json
import time
import numpy as np
import anndata as ad
from scipy import sparse
import torch

parser=argparse.ArgumentParser()
parser.add_argument('data',type=Path)
parser.add_argument('source',type=Path)
parser.add_argument('output',type=Path)
parser.add_argument('--size',type=int)
parser.add_argument('--epochs',type=int,default=20)
args=parser.parse_args()
args.output=args.output.resolve();args.output.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(args.source.resolve()))
from config import Config
from util.trainingprocess_stage1 import TrainingProcessStage1
from util.trainingprocess_stage3 import TrainingProcessStage3
from util.knn import KNN
rna=ad.read_h5ad(args.data/'rna_reference.h5ad')
atac=ad.read_h5ad(args.data/'atac_gene_activity.h5ad')
if args.size:
 rna=rna[:args.size].copy();atac=atac[:args.size].copy()
common=rna.var_names.intersection(atac.var_names)
rna=rna[:,common].copy();atac=atac[:,common].copy()
labels=sorted(rna.obs.cell_type.unique())
encoded=rna.obs.cell_type.map({v:i for i,v in enumerate(labels)}).astype(int).to_numpy()
sparse.save_npz(args.output/'rna.npz',rna.X)
sparse.save_npz(args.output/'atac.npz',atac.X)
np.savetxt(args.output/'labels.txt',encoded,fmt='%d')
config=Config()
config.number_of_class=len(labels);config.input_size=len(common)
config.rna_paths=[str(args.output/'rna.npz')];config.atac_paths=[str(args.output/'atac.npz')]
config.rna_labels=[str(args.output/'labels.txt')];config.atac_labels=[]
config.batch_size=min(256,rna.n_obs,atac.n_obs)
config.epochs_stage1=args.epochs;config.epochs_stage3=args.epochs
config.device=torch.device('cuda:0');config.threads=1
os.chdir(args.output)
Path('output').mkdir(exist_ok=True)
torch.set_num_threads(1);torch.manual_seed(config.seed);np.random.seed(config.seed)
start=time.monotonic()
for Stage in [TrainingProcessStage1,TrainingProcessStage3]:
 model=Stage(config)
 for epoch in range(args.epochs):model.train(epoch)
 model.write_embeddings();KNN(config,neighbors=30,knn_rna_samples=20000)
 torch.save({'encoder':model.model_encoder.state_dict(),'cell':model.model_cell.state_dict()},Stage.__name__+'.pt')
pred=np.loadtxt('output/atac_knn_predictions.txt').astype(int)
assert pred.shape==(atac.n_obs,) and np.isfinite(pred).all()
import pandas as pd
pd.DataFrame({'cell':atac.obs_names,'scJoint':np.array(labels)[pred]}).to_csv('predictions.csv',index=False)
Path('run.json').write_text(json.dumps({'cells':atac.n_obs,'genes':len(common),'epochs_per_stage':args.epochs,'seconds':time.monotonic()-start,'labels':labels,'query_labels_used':False},indent=2))
print(Path('run.json').read_text())
