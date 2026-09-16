from pathlib import Path
import os,json,time
import numpy as np
from scipy import sparse
import torch
import scanpy as sc
import STAMapper
from STAMapper import pipeline
root=Path(__file__).parent
out=root/'stamapper-probe'
out.mkdir(exist_ok=True)
os.chdir(out)
start=time.monotonic()
np.random.seed(20260913)
torch.manual_seed(20260913)
torch.set_num_threads(4)
assert torch.cuda.is_available()
ref=sc.read_h5ad(root/'data/reference.h5ad')
query=sc.read_h5ad(root/'data/query.h5ad')
barcodes=query.obs_names.copy()
assert 'celltype' not in query.obs
devices=set()
def observe(module, inputs):
    if module.__class__.__name__ == 'CGCNet':
        devices.add(str(next(module.parameters()).device))
hook=torch.nn.modules.module.register_module_forward_pre_hook(observe)
outputs=pipeline.training([ref,query],('reference','query'),['celltype',None],n_epochs=3,n_pass=0)
figures=next((out/'_temp').glob('*/0/figs'))
assert all((figures/name).is_file() and (figures/name).stat().st_size>0 for name in ['contingency_matrix.png','contingency_matrix-train.png','heatmap_probas.pdf'])
trainer=outputs['trainer']
hook.remove()
assert any(device.startswith('cuda') for device in devices), devices
assert all(torch.isfinite(p).all() for p in trainer.model.parameters())
assert len(trainer.train_loss)==3 and np.isfinite(trainer.train_loss).all()
# The pipeline already reloads its selected checkpoint for prediction. Check explicit reload too.
state={k:v.detach().clone() for k,v in trainer.model.state_dict().items()}
trainer.load_model_weights(trainer._cur_epoch_adopted)
assert all(torch.equal(v,trainer.model.state_dict()[k]) for k,v in state.items())
obs=outputs['dpair'].obs
selected=obs.loc[obs.dataset=='query']
assert np.array_equal(selected.original_name.to_numpy(),barcodes.to_numpy())
pred=selected['predicted']
assert len(pred)==len(query)
assert pred.notna().all()
query.obs['prediction']=pred.to_numpy()
assert query.obs_names.equals(barcodes)
query.write_h5ad(out/'query.h5ad')
restored=sc.read_h5ad(out/'query.h5ad')
assert restored.obs_names.equals(barcodes) and np.array_equal(restored.X.toarray() if sparse.issparse(restored.X) else restored.X, query.X.toarray() if sparse.issparse(query.X) else query.X)
report={'status':'passed','seconds':time.monotonic()-start,'torch':torch.__version__,'gpu':torch.cuda.get_device_name(),'reference':list(ref.shape),'query':list(query.shape),'epochs':3,'gpu_training':True,'observed_model_devices':sorted(devices),'weights_reload_equal':True,'barcodes_equal':True,'expression_equal':True,'plots_present':True,'purpose':'Compatibility only, not scientific accuracy'}
(out/'result.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
