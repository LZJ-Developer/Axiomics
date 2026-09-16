from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics.cluster import contingency_matrix
from STAMapper.utils.analyze import wrapper_contingency_mat
root=Path(__file__).parent
path=next((root/'stamapper-probe-before-patch').glob('_temp/*/0/obs.csv'))
obs=pd.read_csv(path)
for dataset in ['reference','query']:
 part=obs[obs.dataset==dataset]
 truth=part['REF'].astype(str).to_numpy();pred=part.predicted.astype(str).to_numpy()
 actual=wrapper_contingency_mat(truth,pred,order_rows=False,order_cols=False,as_df=False)
 expected=contingency_matrix(truth,pred)
 np.testing.assert_array_equal(actual,expected)
 assert actual.dtype==np.dtype(int)
print('PASS: patched contingency matrix equals sklearn for actual reference and query predictions')
