from pathlib import Path
import json,time,inspect
import numpy as np
import torch,ot
from ot.gromov import _semirelaxed as sr
from threadpoolctl import threadpool_limits
root=Path('/disk1/dabiao/axiomics-projects/_tracer/stamo')
data=np.load(root/'full/ot-inputs.npz')
source=inspect.getsource(sr.solve_semirelaxed_gromov_linesearch).replace('nx.dot(nx.outer(ones_p, qG), fC2t)','nx.outer(ones_p, nx.dot(qG, fC2t))').replace('nx.dot(nx.outer(ones_p, qdeltaG), fC2t)','nx.outer(ones_p, nx.dot(qdeltaG, fC2t))')
namespace=dict(vars(sr)); exec(source,namespace); sr.solve_semirelaxed_gromov_linesearch=namespace['solve_semirelaxed_gromov_linesearch']
rows=[]
with threadpool_limits(limits=4):
 for n in [5000]:
  i=np.random.RandomState(42).choice(len(data['RNA']),n,False); j=np.random.RandomState(42).choice(len(data['H3K27ac']),n,False)
  import pandas as pd
  baseline=pd.read_csv(root/'full/model/pretrain/RNA_H3K27ac_OT_mapping_matrix.csv',index_col=0).to_numpy()
  C1=ot.dist(data['RNA-coords'][i].astype(float),data['RNA-coords'][i].astype(float),metric='euclidean')
  C2=ot.dist(data['H3K27ac-coords'][j].astype(float),data['H3K27ac-coords'][j].astype(float),metric='euclidean')
  M=ot.dist(data['RNA'][i],data['H3K27ac'][j],metric='euclidean').astype(float)
  C1=C1/C1.max()*M.max(); C2=C2/C2.max()*M.max()
  for backend in ['cuda-float64']:
   torch.cuda.synchronize(); start=time.perf_counter()
   arrays=[M,C1,C2] if backend.startswith('numpy') else [torch.as_tensor(x,device='cuda:0',dtype=torch.float64) for x in [M,C1,C2]]
   T,log=sr.semirelaxed_fused_gromov_wasserstein(*arrays,log=True)
   arr=ot.backend.to_numpy(T); torch.cuda.synchronize(); elapsed=time.perf_counter()-start
   if backend.startswith('numpy'): baseline=arr
   rows.append({'n':n,'backend':backend,'seconds_including_transfers':elapsed,'iterations':len(log['loss'])-1,'loss':float(log['loss'][-1]),'transport_max_abs_vs_cpu':float(abs(arr-baseline).max()),'anchor_agreement_vs_cpu':float(np.mean(arr.argmax(1)==baseline.argmax(1)))})
   print(json.dumps(rows[-1]),flush=True)
(root/'ot-gpu-full-verification.json').write_text(json.dumps(rows,indent=2))
