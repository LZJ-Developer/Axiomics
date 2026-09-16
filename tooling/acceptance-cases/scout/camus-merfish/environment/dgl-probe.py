import json
from pathlib import Path
import torch
import dgl
from dgl.nn import GraphConv
assert torch.cuda.is_available()
graph=dgl.graph(([0,1,2,3],[1,2,3,0])).to('cuda')
x=torch.randn(4,8,device='cuda',requires_grad=True)
layer=GraphConv(8,4).cuda()
y=layer(graph,x)
y.square().sum().backward()
torch.cuda.synchronize()
assert torch.isfinite(y).all() and torch.isfinite(x.grad).all()
report={'status':'passed','torch':torch.__version__,'dgl':dgl.__version__,'gpu':torch.cuda.get_device_name(),'forward_backward_finite':True}
Path(__file__).with_name('dgl-result.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
