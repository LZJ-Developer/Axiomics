import numpy as np
from scipy import sparse
from sklearn.preprocessing import normalize
from STAMapper import pp
matrix=np.array([[0.,0.,0.],[0.,2.,6.],[0.,4.,0.]])
for data in [matrix,sparse.csr_matrix(matrix)]:
 for axis in [0,1]:
  for by,norm in [('sum','l1'),('max','max')]:
   actual=pp.normalize_norms(data,axis=axis,by=by)
   actual=actual.toarray() if sparse.issparse(actual) else actual
   expected=normalize(matrix,axis=axis,norm=norm)
   np.testing.assert_allclose(actual,expected)
   assert np.isfinite(actual).all()
print('PASS: row/column sum/max normalization matches sklearn; dense/sparse and zero rows/columns covered')
