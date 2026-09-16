#!/usr/bin/env bun

import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const bun = process.execPath

const groups = [
  [
    { name: "backend typecheck", cwd: "backend/cli", args: ["run", "typecheck"] },
    { name: "UI typecheck", cwd: "frontend/ui", args: ["run", "typecheck"] },
    { name: "workspace typecheck", cwd: "frontend/workspace", args: ["run", "typecheck"] },
  ],
  [
    {
      name: "media and Responses contracts",
      cwd: "backend/cli",
      args: [
        "test",
        "--timeout",
        "15000",
        "./test/media/store.test.ts",
        "./test/media/deepseek.test.ts",
        "./test/provider/deepseek-responses.test.ts",
        "./test/provider/deepseek-native.test.ts",
        "./test/session/message-v2.test.ts",
        "./test/media/processor.test.ts",
        "./test/session/prompt-attachments.test.ts",
        "./test/tool/artifact-save-file.test.ts",
      ],
    },
    {
      name: "multimodal UI contracts",
      cwd: "frontend/ui",
      args: [
        "test",
        "./src/components/message-part-artifact.test.ts",
        "./src/components/session-turn-science-results.test.ts",
      ],
    },
    { name: "generated SDK contracts", cwd: "tooling/sdk/js", args: ["test"] },
  ],
  [
    {
      name: "replay contracts",
      cwd: "frontend/workspace",
      args: [
        "test",
        "./src/pages/cases/artifacts.test.ts",
        "./src/pages/cases/playback.test.ts",
        "./src/pages/cases/timeline.test.ts",
      ],
    },
  ],
]

const run = async (check: (typeof groups)[number][number]) => {
  console.log(`\n▶ ${check.name}`)
  const child = Bun.spawn([bun, ...check.args], {
    cwd: path.join(root, check.cwd),
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })
  const code = await child.exited
  console.log(`${code === 0 ? "✓" : "✗"} ${check.name}`)
  return { name: check.name, code }
}

const results = []
for (const group of groups) results.push(...(await Promise.all(group.map(run))))
const failed = results.filter((result) => result.code !== 0)
if (failed.length) {
  console.error(`\nFailed: ${failed.map((result) => result.name).join(", ")}`)
  process.exit(1)
}
console.log("\nMultimodal acceptance passed.")
