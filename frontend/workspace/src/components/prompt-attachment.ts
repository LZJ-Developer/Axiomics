export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/** One message may carry more than one file, and the server materialises the
 * whole set under a single cap (`SubtaskAttachments.LIMIT` in
 * backend/cli/src/session/subtask-attachments.ts). Without the total check the
 * composer accepts two 20 MB files and the send fails after upload with
 * "Attachments exceed the 32 MiB byte limit" — an error the user cannot act on.
 * Keep this number equal to the server's LIMIT. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 32 * 1024 * 1024

const images = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const direct = new Set([
  ...images,
  "application/pdf",
  "text/markdown",
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
])
const extensions: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/jsonl",
  yaml: "application/yaml",
  yml: "application/yaml",
  py: "text/x-python",
  r: "text/x-r-source",
  jl: "text/x-julia",
  ipynb: "application/x-ipynb+json",
  tex: "application/x-tex",
  // NumPy archives are the usual handoff for an array an expert wants plotted.
  // Browsers give them no MIME, so the extension is the only signal; the honest
  // type keeps the server from treating the bytes as text.
  npz: "application/octet-stream",
  npy: "application/octet-stream",
  fasta: "text/x-fasta",
  fa: "text/x-fasta",
  fna: "text/x-fasta",
  fastq: "text/x-fastq",
  fq: "text/x-fastq",
  bed: "text/x-bed",
  vcf: "text/x-vcf",
  gff: "text/x-gff",
  gff3: "text/x-gff3",
  pdb: "chemical/x-pdb",
  sdf: "chemical/x-mdl-sdfile",
  mol: "chemical/x-mdl-molfile",
}

export const ATTACHMENT_ACCEPT = [...direct, ...Object.keys(extensions).map((extension) => `.${extension}`)].join(",")

export function attachmentMime(file: { name: string; type: string }) {
  if (direct.has(file.type)) return file.type
  const extension = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
  return extensions[extension]
}

export function attachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function attachmentFormat(file: { name: string; type: string }) {
  const dot = file.name.lastIndexOf(".")
  const extension =
    dot > -1
      ? file.name
          .slice(dot + 1)
          .trim()
          .toUpperCase()
      : ""
  if (extension && extension.length <= 8) return extension
  if (file.type === "application/pdf") return "PDF"
  const subtype = file.type.split("/").pop()?.replace(/^x-/, "").toUpperCase()
  return subtype || "FILE"
}
