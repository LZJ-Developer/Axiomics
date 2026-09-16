from pathlib import Path
import json,time,sys
import anndata as ad
import numpy as np
from scipy import sparse
import pandas as pd
import torch
import scvi
root=Path(__file__).parent
source=root/(sys.argv[1] if len(sys.argv)>1 else 'data')
out=root/(sys.argv[2] if len(sys.argv)>2 else 'scvi-probe')
out.mkdir(exist_ok=True)
start=time.monotonic()
scvi.settings.seed=20260913
torch.set_num_threads(4)
assert torch.cuda.is_available()
ref=ad.read_h5ad(source/'reference.h5ad')
query=ad.read_h5ad(source/'query.h5ad')
assert 'celltype' not in query.obs
query.obs['celltype']='Unknown'
data=ad.concat({'reference':ref,'query':query},join='inner',label='batch',index_unique='-')
assert data.n_vars>100
scvi.model.SCVI.setup_anndata(data,batch_key='batch',labels_key='celltype')
model=scvi.model.SCVI(data,n_latent=10,n_layers=2)
options=dict(max_epochs=3,batch_size=128,accelerator='gpu',devices=1,enable_progress_bar=False,logger=False,enable_checkpointing=False)
model.train(**options)
assert next(model.module.parameters()).is_cuda
scanvi=scvi.model.SCANVI.from_scvi_model(model,unlabeled_category='Unknown')
scanvi.train(**options)
assert next(scanvi.module.parameters()).is_cuda
prediction=scanvi.predict()
latent=scanvi.get_latent_representation()
assert np.isfinite(latent).all()
scanvi.save(out/'model',overwrite=True,save_anndata=True)
restored=scvi.model.SCANVI.load(out/'model',accelerator='gpu',device='auto')
assert np.array_equal(prediction,restored.predict())
np.testing.assert_allclose(latent,restored.get_latent_representation(),rtol=1e-5,atol=1e-5)
mask=data.obs.batch=='query'
query.obs['prediction']=prediction[mask]
query.obs.drop(columns=['celltype'],inplace=True)
query.obsm['X_scANVI']=latent[mask]
query.write_h5ad(out/'query.h5ad')
reloaded=ad.read_h5ad(out/'query.h5ad')
assert reloaded.obs_names.equals(query.obs_names)
assert np.array_equal(reloaded.X.toarray() if sparse.issparse(reloaded.X) else reloaded.X, query.X.toarray() if sparse.issparse(query.X) else query.X)
report={'status':'passed','seconds':time.monotonic()-start,'torch':torch.__version__,'scvi':scvi.__version__,'gpu':torch.cuda.get_device_name(),'shape':list(data.shape),'query':list(query.shape),'epochs':{'SCVI':3,'SCANVI':3},'gpu_training':True,'reload_predictions_equal':True,'finite_latent':True,'barcodes_equal':True,'expression_equal':True,'query_contains_nonintegers':bool(np.any(query.X.data % 1) if sparse.issparse(query.X) else np.any(query.X % 1)),'purpose':'Compatibility only, not scientific accuracy'}
(out/'result.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
