"""Freeze CAMUS ranking before opening held-out author labels."""
import sys,json
from pathlib import Path
import anndata as ad
import numpy as np
import pandas as pd
import snapatac2 as snap
from scCAMUS.metric import CAMUS_prioritize
from sklearn.metrics import accuracy_score,f1_score,classification_report

source,data=map(Path,sys.argv[1:3])
p=data/'atac_peaks.h5ad'
cached=source/'precluster.h5ad'
if cached.exists():
 a=ad.read_h5ad(cached)
else:
 a=ad.read_h5ad(p)
 from scCAMUS.preprocess import precluster_scATAC
 a=precluster_scATAC(a,resolution=0.7)
for method,name in [('GLUE','glue-full'),('scJoint','scjoint-full')]:
 f=pd.read_csv(source/name/'predictions.csv',index_col='cell')
 assert a.obs_names.equals(f.index)
 a.obs[method]=f[method].values
scores=CAMUS_prioritize(a,key_class=['GLUE','scJoint'])
(source/'ranking.json').write_text(json.dumps({'scores':scores,'resolution':0.7,'clusters':a.obs.leiden.nunique(),'query_labels_used':False},indent=2))
a.obs.to_csv(source/'ranked-predictions.csv')
a.write_h5ad(source/'ranked-query.h5ad',compression='gzip')
# Evaluation follows ranking persistence and cannot influence its parameters.
truth=pd.read_csv(source/'heldout-labels.csv',index_col=0).loc[a.obs_names,'celltype']
metrics={m:{'accuracy':accuracy_score(truth,a.obs[m]),'macro_f1':f1_score(truth,a.obs[m],average='macro'),'classification':classification_report(truth,a.obs[m],output_dict=True,zero_division=0)} for m in scores}
metrics['disagreement']=float(np.mean(a.obs.GLUE.astype(str)!=a.obs.scJoint.astype(str)))
(source/'evaluation.json').write_text(json.dumps(metrics,indent=2))
print(json.dumps({'scores':scores,'accuracy':{m:metrics[m]['accuracy'] for m in scores},'disagreement':metrics['disagreement']},indent=2))
