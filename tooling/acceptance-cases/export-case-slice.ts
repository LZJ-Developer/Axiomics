#!/usr/bin/env bun

/**
 * 装配「案例存储切片」—— 让案例回放在任何租户里都能打开。
 *
 * 为什么是这个做法：
 *   回放页（frontend/workspace/src/pages/cases/replay.tsx）走的是普通会话路由，
 *   依赖链有三层且全部绑项目 ——
 *     路由     /:dir → DirectoryLayout，项目解析不出就 navigate("/")
 *     provider SDKProvider / SyncProvider / DataProvider 都按 directory 作用域
 *     产物     data.openArtifact(id) 按当前项目的数据解析
 *   所以「让回放与项目无关」要动三层，而且图表仍点不开。
 *   反过来，只要那个项目在租户的数据里真的存在，三层全部自然成立、零前端改动。
 *
 *   而项目之所以能被发现，是因为 Project.list() 读的是 storage/project/<id>.json
 *   记录（不是扫描 data/projects/）—— 所以切片要落进租户的 storage。
 *
 *   产物层另有自己的一份存储：artifact-store/artifacts.db + blobs/。只拷 storage
 *   的话，对话与 Results 卡片都会渲染，但点开卡片报 404（GET /file/artifact-store/art_…）
 *   —— 卡片只是消息里的引用，真正的字节在产物库里。这里按会话把
 *   versions/artifacts/blobs 一并导出。
 *
 * 用法：
 *   bun run export-case-slice.ts [数据根] [输出目录]
 * 默认：数据根 ~/.axiomics（或 AXIOMICS_DATA_DIR），输出 <仓库>/tooling/acceptance-cases/case-slice
 *
 * 装配一次，之后由 `axiomics-tenant seed-cases <租户>` 分发进各租户。
 */
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { Database } from "bun:sqlite"

const HERE = path.dirname(Bun.fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../..")

const dataRoot = process.argv[2] ?? process.env.AXIOMICS_DATA_DIR ?? path.join(os.homedir(), ".axiomics")
const outRoot = process.argv[3] ?? path.join(HERE, "case-slice")

const { cases } = (await import(
  path.join(REPO, "frontend/workspace/src/pages/cases/catalog.ts")
)) as { cases: Array<{ id: string; segment: string; sessionID: string }> }

const storage = path.join(dataRoot, "storage")
const outStorage = path.join(outRoot, "storage")
const storeRoot = path.join(dataRoot, "artifact-store")
const outStore = path.join(outRoot, "artifact-store")

/**
 * 与 backend/cli/src/artifact/store.ts 的 schema 保持一致 —— 租户侧由同一个
 * 服务打开这份库，列少一个就会在回放时静默丢字段。
 */
const STORE_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO store_meta (key, value) VALUES ('schema_version', '1');
  CREATE TABLE IF NOT EXISTS blobs (
    sha256 TEXT PRIMARY KEY,
    size INTEGER NOT NULL CHECK(size >= 0),
    path TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL DEFAULT 1,
    project_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    current_version_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'trash')),
    trashed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, source_key)
  );
  CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version > 0),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK(size >= 0),
    sha256 TEXT NOT NULL REFERENCES blobs(sha256),
    session_id TEXT NOT NULL,
    message_id TEXT,
    execution_id TEXT,
    source_path TEXT NOT NULL,
    capture_quality TEXT NOT NULL CHECK(capture_quality IN ('exact', 'declared', 'partial', 'unknown')),
    created_at INTEGER NOT NULL,
    UNIQUE(artifact_id, version)
  );
  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    artifact_version_id TEXT NOT NULL UNIQUE REFERENCES versions(id) ON DELETE CASCADE,
    command TEXT, code TEXT,
    status TEXT NOT NULL CHECK(status IN ('succeeded', 'failed', 'cancelled', 'unknown')),
    stdout TEXT, stderr TEXT, model TEXT, provider TEXT,
    created_at INTEGER NOT NULL
  );
`

type VersionRow = {
  id: string
  artifact_id: string
  version: number
  filename: string
  mime_type: string
  size: number
  sha256: string
  session_id: string
  message_id: string | null
  execution_id: string | null
  source_path: string
  capture_quality: string
  created_at: number
}
type ArtifactRow = {
  id: string
  schema_version: number
  project_id: string
  source_key: string
  title: string
  kind: string
  current_version_id: string
  state: string
  trashed_at: number | null
  created_at: number
  updated_at: number
}
type BlobRow = { sha256: string; size: number; path: string; created_at: number }

/**
 * 从项目目录里只取这些 —— 回放真正会打开的只有图表与报告 PDF。
 *
 * 不能用「跳过若干大目录」的反向做法：实测有的案例记录里 worktree 指向的是
 * 整个 axiomics 仓库（backend 286 MB + frontend 144 MB + docs 28 MB），
 * 反向列举永远列不全。目录本身会由 seed_cases 在租户里创建。
 */
const KEEP_IN_WORKTREE = ["figures", "report"]

async function exists(p: string) {
  return fs.access(p).then(
    () => true,
    () => false,
  )
}

async function copy(src: string, dest: string) {
  if (!(await exists(src))) return false
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.cp(src, dest, { recursive: true, preserveTimestamps: true })
  return true
}

await fs.rm(outRoot, { recursive: true, force: true })
await fs.mkdir(outStorage, { recursive: true })
await fs.mkdir(outStore, { recursive: true })

const outDb = new Database(path.join(outStore, "artifacts.db"), { create: true })
outDb.run(STORE_SCHEMA)

const sourceDb = (await exists(path.join(storeRoot, "artifacts.db")))
  ? new Database(path.join(storeRoot, "artifacts.db"), { readonly: true })
  : undefined

/**
 * 把一个会话用到的产物行与字节一起搬进切片。
 *
 * 按 session_id 取版本而不是扫 part JSON：part 里只有 `art_…` 字符串，缺版本号、
 * 缺 blob 摘要，照它反查会二次解析一次；versions 表本来就有这个外键。
 */
async function exportArtifacts(sid: string) {
  if (!sourceDb) return 0
  const versions = sourceDb.query("SELECT * FROM versions WHERE session_id = ?1").all(sid) as VersionRow[]
  for (const version of versions) {
    const artifact = sourceDb.query("SELECT * FROM artifacts WHERE id = ?1").get(version.artifact_id) as ArtifactRow | null
    const blob = sourceDb.query("SELECT * FROM blobs WHERE sha256 = ?1").get(version.sha256) as BlobRow | null
    // 行不齐就跳过：宁可少一张卡，也不要写一条指向不存在字节的版本
    if (!artifact || !blob) continue
    outDb
      .query("INSERT OR IGNORE INTO blobs (sha256, size, path, created_at) VALUES (?1, ?2, ?3, ?4)")
      .run(blob.sha256, blob.size, blob.path, blob.created_at)
    outDb
      .query(
        `INSERT OR IGNORE INTO artifacts
         (id, schema_version, project_id, source_key, title, kind, current_version_id, state, trashed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .run(
        artifact.id,
        artifact.schema_version,
        artifact.project_id,
        artifact.source_key,
        artifact.title,
        artifact.kind,
        artifact.current_version_id,
        artifact.state,
        artifact.trashed_at,
        artifact.created_at,
        artifact.updated_at,
      )
    outDb
      .query(
        `INSERT OR IGNORE INTO versions
         (id, artifact_id, version, filename, mime_type, size, sha256, session_id, message_id,
          execution_id, source_path, capture_quality, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      )
      .run(
        version.id,
        version.artifact_id,
        version.version,
        version.filename,
        version.mime_type,
        version.size,
        version.sha256,
        version.session_id,
        version.message_id,
        version.execution_id,
        version.source_path,
        version.capture_quality,
        version.created_at,
      )
    // blob.path 就是 `blobs/<2>/<2>/<sha>`，与源库同一相对布局
    await copy(path.join(storeRoot, blob.path), path.join(outStore, blob.path))
  }
  return versions.length
}

const index: Array<{ id: string; missing: string[] }> = []

for (const item of cases) {
  // segment 可能是 `prj_x` 或带后缀的 `prj_x~suffix`；存储里用前者
  const prj = item.segment.split("~")[0]!
  const sid = item.sessionID
  const missing: string[] = []

  // 项目本身：有了这条记录，路由与 provider 才会认这个项目
  const want = [
    [`project/${prj}.json`, `project/${prj}.json`],
    [`session/${prj}/${sid}.json`, `session/${prj}/${sid}.json`],
    [`session_workspace/${prj}/${sid}.json`, `session_workspace/${prj}/${sid}.json`],
    [`session_filesystem/${prj}/${sid}.json`, `session_filesystem/${prj}/${sid}.json`],
    [`session_diff/${sid}.json`, `session_diff/${sid}.json`],
    [`project_access/${prj}`, `project_access/${prj}`],
    [`project_trust/${prj}`, `project_trust/${prj}`],
    [`project_filesystem/${prj}.json`, `project_filesystem/${prj}.json`],
    [`managed_project/${prj}.json`, `managed_project/${prj}.json`],
    [`permission-standing/${prj}.json`, `permission-standing/${prj}.json`],
  ] as const

  for (const [from, to] of want) {
    if (!(await copy(path.join(storage, from), path.join(outStorage, to)))) missing.push(from)
  }

  // 转录：消息 + 各自的 parts（parts 按消息 ID 命名，必须先枚举消息）
  const messageDir = path.join(storage, "message", sid)
  const messageFiles = await fs.readdir(messageDir).catch(() => [] as string[])
  if (!messageFiles.length) missing.push(`message/${sid}`)
  for (const file of messageFiles) {
    if (!file.endsWith(".json")) continue
    await copy(path.join(messageDir, file), path.join(outStorage, "message", sid, file))
    const mid = file.slice(0, -5)
    await copy(path.join(storage, "part", mid), path.join(outStorage, "part", mid))
  }

  // 产物：少这一步，对话和 Results 卡片照常渲染，点开卡片却是 404
  const artifactVersions = await exportArtifacts(sid)
  if (!artifactVersions) missing.push(`artifact-store/${sid}`)

  // 项目目录：路由解析出项目后还要它的 worktree 存在，否则界面报
  // "Folder unavailable"。但案例目录有 1–3 GB（work/ results/ data/），
  // 与回放无关 —— 只取骨架与图表/报告，回放要打开的 PDF 就在 report/。
  const record = await Bun.file(path.join(storage, "project", `${prj}.json`)).json().catch(() => undefined)
  const worktree = record?.worktree as string | undefined
  if (worktree && (await exists(worktree))) {
    const dest = path.join(outRoot, "projects", prj)
    await fs.mkdir(dest, { recursive: true })
    for (const name of KEEP_IN_WORKTREE) {
      const src = path.join(worktree, name)
      if (!(await exists(src))) continue
      // 单个条目失败（特殊文件等）不该毁掉整次装配
      await fs
        .cp(src, path.join(dest, name), { recursive: true, preserveTimestamps: true })
        .catch((error) => console.log(`    （跳过 ${prj}/${name}: ${error.code ?? error.message}）`))
    }
  } else {
    missing.push(`worktree ${worktree ?? "(无)"}`)
  }

  index.push({ id: item.id, missing })
  console.log(
    `  ${item.id.padEnd(26)} prj=${prj.slice(0, 20)}… ${messageFiles.length} 条消息 / ${artifactVersions} 个产物版本${missing.length ? `  缺: ${missing.join(", ")}` : ""}`,
  )
}

await Bun.write(path.join(outRoot, "index.json"), JSON.stringify({ generatedFrom: dataRoot, cases: index }, null, 2))

// 统计
let total = 0
async function walk(dir: string): Promise<void> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p)
    else total += (await fs.stat(p)).size
  }
}
await walk(outStorage)
await walk(outStore)

const gaps = index.filter((i) => i.missing.length)
console.log(`\n装配 ${index.length}/${cases.length} 个案例 → ${outRoot}`)
console.log(`切片合计 ${(total / 1024 / 1024).toFixed(1)} MB`)
if (gaps.length) {
  console.log(`\n警告 ${gaps.length} 个案例有缺项：`)
  for (const g of gaps) console.log(`  ${g.id}: ${g.missing.join(", ")}`)
}
