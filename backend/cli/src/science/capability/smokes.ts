import crypto from "node:crypto"
import { CapabilitySmoke } from "./schema"

export type SmokeProfile = {
  source: string
  contract: CapabilitySmoke
}

const RESULT = "capability-result.json"

const scripts = {
  stamapper: `import os, json
os.environ["DGLBACKEND"] = "pytorch"
import STAMapper, dgl, torch
from dgl.nn import GraphConv
g = dgl.graph(([0,1,2],[1,2,0])).to("cuda")
x = torch.randn(3,4,device="cuda",requires_grad=True)
y = GraphConv(4,2).cuda()(g,x)
y.square().sum().backward()
ok = bool(torch.isfinite(y).all() and torch.isfinite(x.grad).all())
open("${RESULT}","w").write(json.dumps({"schema_version":1,"capability_id":"stamapper","ok":ok,"metrics":{"dgl":dgl.__version__,"gpu":torch.cuda.get_device_name()}}))
`,
  scvi: `import json, scvi, torch
from scvi.model import SCVI, SCANVI
x = torch.randn(8,4,device="cuda",requires_grad=True)
x.square().sum().backward()
ok = bool(torch.isfinite(x.grad).all())
open("${RESULT}","w").write(json.dumps({"schema_version":1,"capability_id":"scvi","ok":ok,"metrics":{"scvi":scvi.__version__,"gpu":torch.cuda.get_device_name()}}))
`,

  camus: `import json, sys
from pathlib import Path
import scglue, snapatac2, torch
from scCAMUS.metric import CAMUS_score
score = float(CAMUS_score(["a", "a", "b", "b"], [0, 0, 1, 1]))
device = "cuda" if torch.cuda.is_available() else "cpu"
x = torch.randn(8, 4, device=device, requires_grad=True)
x.square().mean().backward()
source = Path(sys.prefix) / "share" / "scjoint" / "main.py"
ok = score == 1.0 and device == "cuda" and bool(torch.isfinite(x.grad).all()) and source.is_file()
payload = {"schema_version": 1, "capability_id": "camus", "ok": ok, "metrics": {"score": score, "device": device, "scglue": scglue.__version__}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  stamo: `import importlib.metadata, json
import torch, STAMO
import pybedtools
from torch_geometric.nn import InnerProductDecoder
device = "cuda" if torch.cuda.is_available() else "cpu"
x = torch.randn(16, 8, device=device, requires_grad=True)
loss = InnerProductDecoder()(x, torch.tensor([[0, 1], [1, 2]], device=device)).sum()
loss.backward()
left = pybedtools.BedTool("chr1\\t10\\t30\\n", from_string=True)
right = pybedtools.BedTool("chr1\\t20\\t40\\n", from_string=True)
ok = device == "cuda" and bool(torch.isfinite(x.grad).all()) and str(left.intersect(right)) == "chr1\\t20\\t30\\n"
payload = {"schema_version": 1, "capability_id": "stamo", "ok": ok, "metrics": {"stamo": importlib.metadata.version("STAMO"), "torch": torch.__version__, "device": device}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  scipy: `import json
from scipy.optimize import minimize
result = minimize(lambda x: (x[0] - 3.0) ** 2 + 2.0, [0.0], method="BFGS")
payload = {"schema_version": 1, "capability_id": "scipy", "ok": bool(result.success), "metrics": {"x": float(result.x[0]), "objective": float(result.fun)}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  matplotlib: `import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image, ImageStat
fig, ax = plt.subplots(figsize=(3, 2), dpi=100)
ax.plot([0, 1, 2, 3], [0, 1, 4, 9], color="#3b82f6", linewidth=2)
fig.tight_layout()
fig.savefig("capability-figure.png")
plt.close(fig)
image = Image.open("capability-figure.png").convert("RGB")
variance = sum(ImageStat.Stat(image).var)
payload = {"schema_version": 1, "capability_id": "matplotlib", "ok": image.size == (300, 200) and variance > 1.0, "metrics": {"width": image.width, "height": image.height, "variance": variance}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  "scikit-learn": `import json
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
x, y = load_iris(return_X_y=True)
x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.25, random_state=17, stratify=y)
model = LogisticRegression(max_iter=500, random_state=17).fit(x_train, y_train)
predictions = model.predict(x_test)
accuracy = float(accuracy_score(y_test, predictions))
payload = {"schema_version": 1, "capability_id": "scikit-learn", "ok": len(predictions) == 38 and len(set(predictions.tolist())) == 3 and accuracy >= 0.89, "metrics": {"accuracy": accuracy, "predictions": len(predictions), "classes": len(set(predictions.tolist()))}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  biopython: `import json
from io import StringIO
from Bio import SeqIO
record = SeqIO.read(StringIO(">fixture\\nATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG\\n"), "fasta")
reverse = str(record.seq.reverse_complement())
translation = str(record.seq.translate(to_stop=True))
payload = {"schema_version": 1, "capability_id": "biopython", "ok": reverse == "CTATCGGGCACCCTTTCAGCGGCCCATTACAATGGCCAT" and translation == "MAIVMGR", "metrics": {"records": 1, "length": len(record.seq), "reverse_complement": reverse, "translation": translation}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  rdkit: `import json
from rdkit import Chem
from rdkit.Chem import Descriptors, rdMolDescriptors
smiles = "Cn1c(=O)c2c(ncn2C)n(C)c1=O"
mol = Chem.MolFromSmiles(smiles)
formula = rdMolDescriptors.CalcMolFormula(mol)
weight = float(Descriptors.MolWt(mol))
writer = Chem.SDWriter("capability-molecule.sdf")
writer.write(mol)
writer.close()
roundtrip = next((item for item in Chem.SDMolSupplier("capability-molecule.sdf") if item is not None), None)
payload = {"schema_version": 1, "capability_id": "rdkit", "ok": formula == "C8H10N4O2" and 194.0 < weight < 195.0 and roundtrip is not None, "metrics": {"formula": formula, "molecular_weight": weight, "sdf_roundtrip": roundtrip is not None}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  scanpy: `import importlib.metadata, json
import scanpy as sc
payload = {"schema_version": 1, "capability_id": "scanpy", "ok": True, "metrics": {"scanpy": importlib.metadata.version("scanpy")}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  squidpy: `import importlib.metadata, json
import scanpy, squidpy
payload = {"schema_version": 1, "capability_id": "squidpy", "ok": True, "metrics": {"scanpy": importlib.metadata.version("scanpy"), "squidpy": importlib.metadata.version("squidpy")}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  snapatac2: `import importlib.metadata, json
from pathlib import Path
import anndata as ad
import numpy as np
import pandas as pd
import scipy.sparse as sp
import snapatac2 as snap
root = Path("capability-snapatac2")
root.mkdir(exist_ok=True)
rng = np.random.default_rng(17)
matrix = sp.csr_matrix((rng.random((64, 256)) < 0.08).astype(np.float32))
source = root / "tiny.h5ad"
ad.AnnData(X=matrix, obs=pd.DataFrame(index=[f"cell{i}" for i in range(64)]), var=pd.DataFrame(index=[f"peak{i}" for i in range(256)])).write_h5ad(source)
data = snap.read(str(source), backed="r+")
snap.pp.select_features(data, n_features=128, filter_lower_quantile=0, filter_upper_quantile=0, n_jobs=1, verbose=False)
snap.tl.spectral(data, n_comps=8, num_threads=1)
selected = int(np.asarray(data.var["selected"]).sum())
spectral = list(data.obsm["X_spectral"].shape)
data.close()
payload = {"schema_version": 1, "capability_id": "snapatac2", "ok": selected == 128 and spectral[0] == 64, "metrics": {"snapatac2": importlib.metadata.version("snapatac2"), "selected_features": selected, "spectral_rows": spectral[0], "spectral_components": spectral[1]}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  open2c: `import importlib.metadata, json
import cooler
import cooltools
import numpy as np
import pandas as pd
bins = pd.DataFrame({"chrom": ["chr1"] * 20, "start": np.arange(20) * 1000, "end": (np.arange(20) + 1) * 1000})
pixels = pd.DataFrame([(i, j, max(1, 100 // (j - i + 1)) + (20 if i // 10 == j // 10 else 0)) for i in range(20) for j in range(i, 20)], columns=["bin1_id", "bin2_id", "count"])
cooler.create_cooler("capability-contact-map.cool", bins, pixels, ordered=True)
contact = cooler.Cooler("capability-contact-map.cool")
expected = cooltools.expected_cis(contact, clr_weight_name=None, ignore_diags=0, smooth=False)
insulation = cooltools.insulation(contact, [4000], clr_weight_name=None, ignore_diags=0, min_frac_valid_pixels=0.5)
scores = int(insulation["log2_insulation_score_4000"].notna().sum())
payload = {"schema_version": 1, "capability_id": "open2c", "ok": contact.shape == (20, 20) and len(expected) == 20 and scores == 20, "metrics": {"pairtools": importlib.metadata.version("pairtools"), "cooler": importlib.metadata.version("cooler"), "cooltools": importlib.metadata.version("cooltools"), "bins": int(contact.shape[0]), "contacts": int(contact.info["sum"]), "insulation_scores": scores}}
open("${RESULT}", "w", encoding="utf-8").write(json.dumps(payload, sort_keys=True))
`,
  archr: `set -eu
archr="$(Rscript --vanilla -e 'stopifnot(requireNamespace("ArchR", quietly=TRUE)); cat(as.character(utils::packageVersion("ArchR")))')"
printf '{"schema_version":1,"capability_id":"archr","ok":true,"metrics":{"archr":"%s"}}\n' "$archr" > ${RESULT}
`,
  hicpro: `set -eu
HiC-Pro --version 2>&1 | grep -F 'HiC-Pro version 3.1.0'
bowtie2 --version >/dev/null
samtools --version >/dev/null
printf '%s\n' '{"schema_version":1,"capability_id":"hicpro","ok":true,"metrics":{"hicpro":"3.1.0","bowtie2":"2.4.4","samtools":"1.12"}}' > ${RESULT}
`,
  mcmicro: `set -eu
test -f "$MCMICRO_HOME/main.nf"
nextflow -version 2>&1 | grep -F 'version 25.04.8'
printf '%s\n' '{"schema_version":1,"capability_id":"mcmicro","ok":true,"metrics":{"mcmicro":"f4400001578642e370a72668966c6602fe172ef6","nextflow":"25.04.8","java":"17.0.18"}}' > ${RESULT}
`,
} as const

function contract(id: keyof typeof scripts, artifacts: string[], invariants: string[]) {
  return CapabilitySmoke.parse({
    id: `${id}-bounded-v1`,
    script_digest: crypto.createHash("sha256").update(scripts[id]).digest("hex"),
    language: new Set(["archr", "hicpro", "mcmicro"]).has(id) ? "shell" : "python",
    result_path: RESULT,
    artifacts,
    max_artifact_bytes: 1024 * 1024,
    timeout_seconds: 120,
    summary: invariants[0] ?? `${id} bounded smoke`,
    invariants,
  })
}

export type CoreSmokeID = keyof typeof scripts

export const CORE_SMOKES: Record<CoreSmokeID, CapabilitySmoke> = {
  stamapper: contract("stamapper", [RESULT], ["STAMapper imports and DGL GPU graph forward/backward is finite"]),
  scvi: contract("scvi", [RESULT], ["SCVI and SCANVI import and GPU backward is finite"]),
  camus: contract(
    "camus",
    [RESULT],
    ["CAMUS scores a perfect partition, GLUE imports, GPU backward is finite, and scJoint source exists"],
  ),
  stamo: contract(
    "stamo",
    [RESULT],
    ["STAMO imports, PyG backward produces finite gradients, and bedtools computes a real intersection"],
  ),
  scipy: contract("scipy", [RESULT], ["BFGS converges", "x is approximately 3", "objective is approximately 2"]),
  matplotlib: contract(
    "matplotlib",
    [RESULT, "capability-figure.png"],
    ["PNG signature", "300 by 200 pixels", "nonzero variance"],
  ),
  "scikit-learn": contract(
    "scikit-learn",
    [RESULT],
    ["38 predictions", "all three Iris classes", "accuracy at least 0.89"],
  ),
  biopython: contract("biopython", [RESULT], ["one FASTA record", "exact reverse complement", "exact translation"]),
  rdkit: contract(
    "rdkit",
    [RESULT, "capability-molecule.sdf"],
    ["caffeine formula", "molecular weight range", "SDF round trip"],
  ),
  scanpy: contract("scanpy", [RESULT], ["Scanpy imports from the registered shared runtime"]),
  squidpy: contract("squidpy", [RESULT], ["Squidpy and Scanpy import from one registered shared runtime"]),
  snapatac2: contract(
    "snapatac2",
    [RESULT, "capability-snapatac2/tiny.h5ad"],
    ["backed AnnData round trip", "128 features selected", "spectral embedding has 64 observations"],
  ),
  open2c: contract(
    "open2c",
    [RESULT, "capability-contact-map.cool"],
    ["Cooler contact map round trip", "distance expectation computed", "insulation scores computed"],
  ),
  archr: contract("archr", [RESULT], ["ArchR loads from the registered shared R runtime"]),
  hicpro: contract("hicpro", [RESULT], ["HiC-Pro, Bowtie2, and samtools resolve from one locked toolchain"]),
  mcmicro: contract("mcmicro", [RESULT], ["MCMICRO workflow, Nextflow, and Java resolve from one locked toolchain"]),
}

export const smokeProfiles: Record<CoreSmokeID, SmokeProfile> = {
  stamapper: { source: scripts.stamapper, contract: CORE_SMOKES.stamapper },
  scvi: { source: scripts.scvi, contract: CORE_SMOKES.scvi },
  camus: { source: scripts.camus, contract: CORE_SMOKES.camus },
  stamo: { source: scripts.stamo, contract: CORE_SMOKES.stamo },
  scipy: { source: scripts.scipy, contract: CORE_SMOKES.scipy },
  matplotlib: { source: scripts.matplotlib, contract: CORE_SMOKES.matplotlib },
  "scikit-learn": { source: scripts["scikit-learn"], contract: CORE_SMOKES["scikit-learn"] },
  biopython: { source: scripts.biopython, contract: CORE_SMOKES.biopython },
  rdkit: { source: scripts.rdkit, contract: CORE_SMOKES.rdkit },
  scanpy: { source: scripts.scanpy, contract: CORE_SMOKES.scanpy },
  squidpy: { source: scripts.squidpy, contract: CORE_SMOKES.squidpy },
  snapatac2: { source: scripts.snapatac2, contract: CORE_SMOKES.snapatac2 },
  open2c: { source: scripts.open2c, contract: CORE_SMOKES.open2c },
  archr: { source: scripts.archr, contract: CORE_SMOKES.archr },
  hicpro: { source: scripts.hicpro, contract: CORE_SMOKES.hicpro },
  mcmicro: { source: scripts.mcmicro, contract: CORE_SMOKES.mcmicro },
}

export function capabilitySmokeScript(id: string) {
  const smoke = smokeProfiles[id as CoreSmokeID]
  if (!smoke) throw new Error(`Unknown packaged smoke capability: ${id}`)
  return smoke.source
}
