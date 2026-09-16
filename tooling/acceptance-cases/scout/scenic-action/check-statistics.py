from pathlib import Path
import pandas as pd,numpy as np,json,itertools
from scipy.stats import mannwhitneyu,false_discovery_control
p=Path('/disk1/dabiao/axiomics-projects/09-scenic-action')
m=pd.read_csv(p/'data/cell_metadata.csv',low_memory=False).set_index('Cell')
a=pd.read_csv(p/'data/aucell_matrix_subset.csv',index_col=0)
assert a.index.is_unique and m.index.is_unique and set(a.index)==set(m.index)
pb=a.join(m[['patient_uid']]).groupby('patient_uid').mean()
b=pb.loc[pb.index.str.startswith('Bone_')].to_numpy();r=pb.loc[pb.index.str.startswith('Brain_')].to_numpy()
v=np.vstack([b,r]);obs=b.mean(0)-r.mean(0);counts=np.zeros(v.shape[1]);total=0
for indices in itertools.combinations(range(len(v)),len(b)):
 s=v[list(indices)].sum(0);diff=s/len(b)-(v.sum(0)-s)/len(r)
 counts+=(np.abs(diff)>=np.abs(obs)-1e-12);total+=1
q=false_discovery_control(counts/total)
wm=np.array([mannwhitneyu(b[:,i],r[:,i],alternative='two-sided').pvalue for i in range(b.shape[1])]);wq=false_discovery_control(wm)
out={'patients':len(pb),'regulons':len(pb.columns),'exact_label_allocations':total,'exact_permutation_significant':int((q<.05).sum()),'min_exact_q':float(q.min()),'mann_whitney_significant':int((wq<.05).sum()),'candidates':{x:{'mean_difference_Bone_minus_Brain':float(obs[list(pb.columns).index(x+'(+)')]),'exact_permutation_q':float(q[list(pb.columns).index(x+'(+)')]),'mann_whitney_q':float(wq[list(pb.columns).index(x+'(+)')])} for x in ['MSX2','HOXA1','ELF4']}}
Path('/disk1/dabiao/axiomics-projects/_tracer/scenic-action/statistics-check.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
