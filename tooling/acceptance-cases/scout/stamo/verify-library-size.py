"""Compare the original and patched cross_predict reduction, directly from source."""
import ast
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from scipy import sparse

root = Path(sys.argv[1]).resolve()
original = subprocess.check_output(['git', 'show', 'HEAD:STAMO/utils.py'], cwd=root, text=True)
patched = (root / 'STAMO/utils.py').read_text()

def reduction(source, matrix, neighbors):
    function = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'cross_predict')
    nodes = []
    for node in function.body[2:]:  # Skip docstring and unchanged nearest-neighbor lookup.
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'predict_X' for t in node.targets):
            expression = next(k.value for k in node.value.keywords if k.arg == 'target_libsize')
            scope = {'np': np, 'ref_adata': SimpleNamespace(X=matrix), 'knn_ind': neighbors}
            exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual-source>', 'exec'), scope)
            return eval(compile(ast.Expression(body=expression), '<actual-source>', 'eval'), scope)
        nodes.append(node)
    raise AssertionError('Prediction call missing')

rng = np.random.default_rng(2026)
for dtype in (np.int32, np.int64, np.float32, np.float64):
    matrix = rng.poisson(0.3, (81, 503)).astype(dtype)
    matrix[0] = 0
    neighbors = rng.integers(0, len(matrix), (47, 15))
    neighbors[0] = 0
    for constructor in (sparse.csr_matrix, sparse.csc_matrix):
        data = constructor(matrix)
        expected = reduction(original, data, neighbors)
        actual = reduction(patched, data, neighbors)
        np.testing.assert_allclose(actual, expected, rtol=2e-6, atol=1e-6)
        np.testing.assert_allclose(reduction(patched, matrix, neighbors), expected, rtol=2e-6, atol=1e-6)
        print(dtype.__name__, constructor.__name__, 'max_abs_error', float(np.max(np.abs(actual - expected))))
print('PASS: original-source equivalence, sparse/dense, zero counts, repeated neighbors, four dtypes')
print('9548 x 15 x 19588 float32 neighbor tensor avoided:', 9548 * 15 * 19588 * 4 / 1024**3, 'GiB')
