/** v2 semantic fixture: a richer, "already successful" run that exercises fs replay,
 *  content-addressed blobs (big stdout / plots / oversize text) and span grouping. */
import { digestOf, type Ev } from "./schema"

export function buildRunV2(): { events: Ev[]; blobs: Map<string, string> } {
  const events: Ev[] = []
  const blobs = new Map<string, string>()
  const W0 = 1_700_000_000_000
  const emit = (e: Omit<Ev, "seq" | "wall">) => {
    events.push({ ...e, seq: events.length, wall: W0 + events.length * 37 } as Ev)
  }
  const blob = (content: string) => {
    const digest = digestOf(content)
    blobs.set(digest, content)
    return { digest, bytes: Buffer.byteLength(content, "utf8") }
  }

  const py1 = `import scanpy as sc
adata = sc.read_10x_h5("data/pbmc_raw.h5")
adata = qc(adata, min_genes=200, pct_mt=20)   # v1
adata.write("norm.h5ad")`
  const py2 = py1.replace("# v1", "# v2") + `\nsc.pp.normalize_total(adata)\nsc.pp.pca(adata, n_comps=30)`
  const py3 = py2 + `\nsc.pp.neighbors(adata)\nsc.tl.umap(adata)  # v3`
  const bigStdout = Array.from({ length: 40 }, (_, i) => `[scanpy] step ${i}: ok (n=6281, dims=50)`).join("\n") + "\n"

  // meta + plan
  emit({ kind: "meta", goal: "10x PBMC: QC→norm→PCA→UMAP→注释，全流程可复现", model: "qwen3-30b-a3b" })
  emit({ kind: "msg", role: "agent", text: "目标已明确。先读入数据并做 QC，随后固化脚本 `run_qc.py` 便于回放。" })

  // first tool span: read
  emit({ kind: "tool_start", span: "s1", tool: "python", cmd: "python scripts/run_qc.py --read" })
  emit({ kind: "tool_out", span: "s1", text: "reading data/pbmc_raw.h5…" })
  const out1 = blob("read: AnnData 7233 x 15248\n" + bigStdout)
  emit({ kind: "tool_end", span: "s1", exit: 0, durMs: 3_120, out: out1 })

  // fs: author the pipeline script, v1
  emit({
    kind: "fs_write",
    path: "scripts/run_qc.py",
    digest: digestOf(py1),
    bytes: Buffer.byteLength(py1),
    prev: null,
    text: py1,
  })
  emit({
    kind: "fs_write",
    path: "notes/scratch.md",
    digest: digestOf("# scratch"),
    bytes: 9,
    prev: null,
    text: "# scratch",
  })
  emit({
    kind: "fs_write",
    path: "scripts/legacy_plot.py",
    digest: digestOf("print('legacy')"),
    bytes: 15,
    prev: null,
    text: "print('legacy')",
  })

  emit({ kind: "msg", role: "agent", text: "QC 阈值已定：min_genes=200、线粒体<20%。" })
  emit({ kind: "tool_start", span: "s2", tool: "python", cmd: "python scripts/run_qc.py --qc" })
  emit({ kind: "tool_out", span: "s2", text: "filter_cells: 7233 -> 6281" })
  const out2 = blob("QC 完成: 7233 -> 6281 (13.2%)\n" + bigStdout)
  emit({ kind: "tool_end", span: "s2", exit: 0, durMs: 9_400, out: out2 })
  const qcSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><text x="10" y="24" font-family="sans-serif">QC violin (mock)</text></svg>`
  const qcP = blob(qcSvg)
  emit({
    kind: "artifact",
    name: "qc-violin.svg",
    digest: qcP.digest,
    mime: "image/svg+xml",
    bytes: qcP.bytes,
    width: 360,
    height: 200,
  })

  // fs: v2 (norm+pca), oversize text file (csv) as blob-backed fs snapshot
  emit({
    kind: "fs_write",
    path: "scripts/run_qc.py",
    digest: digestOf(py2),
    bytes: Buffer.byteLength(py2),
    prev: digestOf(py1),
    text: py2,
  })
  const csv = Array.from({ length: 400 }, (_, r) => `g${r},0.5${r % 10},0.1${r % 5}`).join("\n")
  const csvB = blob(csv)
  emit({ kind: "fs_write", path: "out/matrix_summary.csv", digest: csvB.digest, bytes: csvB.bytes, prev: null })
  emit({ kind: "state", label: "after-QC", data: { n_cells: 6281, n_genes: 15248, removed_pct: 13.2 } })

  // umap span
  emit({ kind: "msg", role: "agent", text: "继续 v3：UMAP + Leiden，可视化聚类。" })
  emit({ kind: "tool_start", span: "s3", tool: "python", cmd: "python scripts/run_qc.py --umap" })
  emit({ kind: "tool_out", span: "s3", text: "neighbors+umap ok" })
  const out3 = blob("umap coords computed (n=6281)\n" + bigStdout)
  emit({ kind: "tool_end", span: "s3", exit: 0, durMs: 18_700, out: out3 })
  const umapSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><text x="10" y="24" font-family="sans-serif">UMAP 6 clusters (mock)</text></svg>`
  const uP = blob(umapSvg)
  emit({
    kind: "artifact",
    name: "umap-clusters.svg",
    digest: uP.digest,
    mime: "image/svg+xml",
    bytes: uP.bytes,
    width: 360,
    height: 200,
  })

  // fs: v3 + result notes + delete scratch + move legacy→plotting
  emit({
    kind: "fs_write",
    path: "scripts/run_qc.py",
    digest: digestOf(py3),
    bytes: Buffer.byteLength(py3),
    prev: digestOf(py2),
    text: py3,
  })
  emit({
    kind: "fs_write",
    path: "notes/result.md",
    digest: digestOf("# 结果\n6 clusters, UMAP 稳定"),
    bytes: 32,
    prev: null,
    text: "# 结果\n6 clusters, UMAP 稳定",
  })
  emit({ kind: "fs_delete", path: "notes/scratch.md" })
  emit({ kind: "fs_move", from: "scripts/legacy_plot.py", to: "scripts/plotting.py" })

  emit({
    kind: "state",
    label: "final",
    data: { n_clusters: 6, umap_done: true, files: ["scripts/run_qc.py", "notes/result.md", "out/matrix_summary.csv"] },
  })
  emit({ kind: "note", sev: "info", text: "本轨迹为 v2 模型校验用 mock 数据，未调用 LLM。" })

  // stress the content-addressed dedup path: agent "rewrites" run_qc.py but content is identical → same digest
  emit({
    kind: "fs_write",
    path: "scripts/run_qc.py",
    digest: digestOf(py3),
    bytes: Buffer.byteLength(py3),
    prev: digestOf(py3),
    text: py3,
  })
  emit({ kind: "note", sev: "warn", text: "上一步 fs_write 内容未变（digest 相同）——渲染时无需新增 blob。" })
  return { events, blobs }
}
