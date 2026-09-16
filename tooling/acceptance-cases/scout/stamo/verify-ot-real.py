from pathlib import Path
import inspect,json,time
import numpy as np
import scanpy as sc
import STAMO,ot
from ot.gromov import _semirelaxed as sr
from threadpoolctl import threadpool_limits
root=Path('/disk1/dabiao/axiomics-projects/_tracer/stamo/full')
cache=root/'ot-inputs.npz'
if not cache.exists():
 model=STAMO.models.load_model(root/'model/pretrain/pretrain.dill')
 arrays={}
 for name,rep in [('RNA','X_feat'),('H3K27ac','X_lsi')]:
  a=sc.read_h5ad(root/(name+'-prepared.h5ad'))
  a.uns.pop(STAMO.utils.config.ANNDATA_KEY,None)
  STAMO.models.configure_dataset(a,'NB',use_rep=rep,use_layer='counts',use_obs_names=True)
  arrays[name]=model.encode_data_minibatch(name,a)
  arrays[name+'-coords']=a.obsm['spatial']
 np.savez(cache,**arrays)
 print('Real pretrain embeddings cached',flush=True)
original=sr.solve_semirelaxed_gromov_linesearch
source=inspect.getsource(original).replace('nx.dot(nx.outer(ones_p, qG), fC2t)','nx.outer(ones_p, nx.dot(qG, fC2t))').replace('nx.dot(nx.outer(ones_p, qdeltaG), fC2t)','nx.outer(ones_p, nx.dot(qdeltaG, fC2t))')
namespace=dict(vars(sr)); exec(source,namespace); optimized=namespace[original.__name__]
data=np.load(cache); rows=[]
with threadpool_limits(limits=4):
 for seed,n,m in [(42,256,320),(17,512,512),(101,1024,900)]:
  rng=np.random.default_rng(seed)
  i=rng.choice(len(data['RNA']),n,replace=False); j=rng.choice(len(data['H3K27ac']),m,replace=False)
  C1=ot.dist(data['RNA-coords'][i].astype(float),data['RNA-coords'][i].astype(float),metric='euclidean')
  C2=ot.dist(data['H3K27ac-coords'][j].astype(float),data['H3K27ac-coords'][j].astype(float),metric='euclidean')
  M=ot.dist(data['RNA'][i],data['H3K27ac'][j],metric='euclidean')
  C1=C1/C1.max()*M.max(); C2=C2/C2.max()*M.max()
  results=[]
  for label,fn in [('original',original),('optimized',optimized)]:
   sr.solve_semirelaxed_gromov_linesearch=fn
   t=time.perf_counter(); T,log=sr.semirelaxed_fused_gromov_wasserstein(M,C1,C2,log=True)
   results.append((T,log)); rows.append({'seed':seed,'shape':[n,m],'variant':label,'seconds':time.perf_counter()-t,'iterations':len(log['loss'])-1,'loss':float(log['loss'][-1])})
  delta=np.max(abs(results[0][0]-results[1][0])); agree=np.mean(results[0][0].argmax(1)==results[1][0].argmax(1))
  rows.append({'seed':seed,'transport_max_abs':float(delta),'anchor_agreement':float(agree)})
  print(json.dumps(rows[-3:]),flush=True)
  assert agree==1 and np.allclose(results[0][0],results[1][0],rtol=1e-6,atol=1e-9)
sr.solve_semirelaxed_gromov_linesearch=original
(root.parent/'ot-real-verification.json').write_text(json.dumps(rows,indent=2))
