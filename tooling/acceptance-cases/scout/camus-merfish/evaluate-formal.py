from pathlib import Path
import json
import numpy as np,pandas as pd,anndata as ad
from scipy import sparse
from sklearn.metrics import accuracy_score,adjusted_rand_score,f1_score,confusion_matrix
root=Path('/disk1/dabiao/axiomics-projects/_tracer/camus-merfish')
project=Path('/disk1/dabiao/axiomics-projects/08-camus-merfish')
scored=project/'work/runs/camus/camus_scores.json'
assert scored.is_file(), 'Freeze CAMUS method scores before opening held-out labels'
score=json.loads(scored.read_text())
(root/'frozen-camus-scores.json').write_text(json.dumps(score,indent=2))
# Only this independent evaluation reads author labels; nothing is mounted into the Agent project.
truth=ad.read_h5ad(root/'input-check/MERFISH_hypothalamic_8.h5ad')
clean=ad.read_h5ad(project/'data/merfish.h5ad')
assert 'celltype' not in clean.obs
assert clean.obs_names.equals(truth.obs_names)
np.testing.assert_array_equal(clean.X,truth.X)
report={'source':'Fresh Axiomics annotations; held-out author labels opened after CAMUS scores were written','camus':score,'methods':{}}
for name,folder,key in [('STAMapper','stamapper_raw','stamapper_pred'),('scANVI','scanvi','scanvi_pred')]:
 filename='query_stamapper.h5ad' if name=='STAMapper' else 'query_scanvi.h5ad'
 a=ad.read_h5ad(project/'work/runs'/folder/filename)
 assert a.obs_names.equals(clean.obs_names) and a.obs_names.is_unique
 expected=clean[:,a.var_names].X
 np.testing.assert_allclose(a.X.toarray() if sparse.issparse(a.X) else a.X,expected.toarray() if sparse.issparse(expected) else expected,rtol=0,atol=0)
 labels=truth.obs['celltype'].astype(str).to_numpy();pred=a.obs[key].astype(str).to_numpy()
 assert not pd.isna(a.obs[key]).any()
 classes=sorted(set(labels)|set(pred))
 pd.DataFrame(confusion_matrix(labels,pred,labels=classes),index=classes,columns=classes).to_csv(root/f'{name.lower()}-author-confusion.csv')
 report['methods'][name]={'n':len(pred),'author_label_agreement':accuracy_score(labels,pred),'ARI':adjusted_rand_score(labels,pred),'macro_f1':f1_score(labels,pred,average='macro',zero_division=0),'predicted_counts':pd.Series(pred).value_counts().to_dict(),'expression_values_preserved':True,'barcodes_preserved':True}
(root/'formal-evaluation.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
