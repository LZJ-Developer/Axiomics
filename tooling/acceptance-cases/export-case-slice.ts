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
 * 用法：
 *   bun run export-case-slice.ts [数据根] [输出目录]
 * 默认：数据根 ~/.axiomics（或 AXIOMICS_DATA_DIR），输出 <仓库>/tooling/acceptance-cases/case-slice
 *
 * 装配一次，之后由 `axiomics-tenant seed-cases <租户>` 分发进各租户。
 */
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const HERE = path.dirname(Bun.fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../..")

const dataRoot = process.argv[2] ?? process.env.AXIOMICS_DATA_DIR ?? path.join(os.homedir(), ".axiomics")
const outRoot = process.argv[3] ?? path.join(HERE, "case-slice")

const { cases } = (await import(
  path.join(REPO, "frontend/workspace/src/pages/cases/catalog.ts")
)) as { cases: Array<{ id: string; segment: string; sessionID: string }> }

const storage = path.join(dataRoot, "storage")
const outStorage = path.join(outRoot, "storage")

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
  console.log(`  ${item.id.padEnd(26)} prj=${prj.slice(0, 20)}… ${messageFiles.length} 条消息${missing.length ? `  缺: ${missing.join(", ")}` : ""}`)
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

const gaps = index.filter((i) => i.missing.length)
console.log(`\n装配 ${index.length}/${cases.length} 个案例 → ${outRoot}`)
console.log(`切片合计 ${(total / 1024 / 1024).toFixed(1)} MB`)
if (gaps.length) {
  console.log(`\n警告 ${gaps.length} 个案例有缺项：`)
  for (const g of gaps) console.log(`  ${g.id}: ${g.missing.join(", ")}`)
}
