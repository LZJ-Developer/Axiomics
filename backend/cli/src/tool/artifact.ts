import z from "zod"
import path from "node:path"
import fs from "node:fs/promises"
import { Tool } from "./tool"
import { ArtifactStore } from "@/artifact/store"
import { File } from "@/file"
import { ArtifactFile } from "@/file/artifacts"
import { Instance } from "@/project/instance"
import { SessionFilesystem } from "@/session/filesystem"
import { Provenance } from "@/science/provenance/store"
import type { Node, Run } from "@/science/provenance/store"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool.artifact" })

function result(title: string, output: string, metadata: Record<string, unknown> = {}) {
  return { title, output, metadata }
}

const runnable = (node: Node | undefined): node is Run =>
  node?.kind === "run" && "tool" in node && typeof node.tool === "string"

function savedExecution(run: Run): Omit<ArtifactStore.Execution, "id" | "artifactVersionID" | "createdAt"> {
  const envelope = run.provenance
  const status = (() => {
    switch (envelope?.outputs.status) {
      case "succeeded":
        return "succeeded" as const
      case "failed":
        return "failed" as const
      case "cancelled":
      case "interrupted":
        return "cancelled" as const
      default:
        return "unknown" as const
    }
  })()
  const files = (envelope?.outputs.items ?? []).flatMap((item) =>
    item.path.status === "available" ? [{ path: item.path.value, sha256: item.sha256, size: item.size }] : [],
  )
  return {
    command: run.tool,
    ...(envelope?.input.code.status === "available" ? { code: envelope.input.code.value } : {}),
    status,
    ...(typeof run.meta?.stdout === "string" ? { stdout: run.meta.stdout } : {}),
    ...(typeof run.meta?.stderr === "string" ? { stderr: run.meta.stderr } : {}),
    ...(typeof run.meta?.effort === "string" ? { effort: run.meta.effort } : {}),
    source: run.id,
    ...(run.inputs ? { inputs: run.inputs } : {}),
    captureQuality: envelope ? "exact" : "declared",
    files,
    ...(envelope
      ? {
          environment: {
            host: envelope.environment.host,
            kernel: envelope.environment.kernel,
            runID: envelope.identity.run_id,
          },
        }
      : {}),
  }
}

async function traceSavedArtifact(saved: ArtifactStore.Artifact, run?: Run) {
  const scope = { projectID: Instance.project.id, directory: Instance.directory }
  const version = saved.current
  const id = ArtifactStore.reviewTargetID(version.id, version.sha256)
  const existing = await Provenance.find(scope, id)
  if (
    existing &&
    (existing.kind !== "artifact" ||
      !("contentHash" in existing) ||
      existing.contentHash !== version.sha256 ||
      existing.meta?.artifactID !== saved.id ||
      existing.meta?.versionID !== version.id)
  ) {
    throw new Error(`Provenance target ${id} conflicts with the immutable artifact version`)
  }
  if (!existing) {
    await Provenance.recordOwned(scope, {
      id,
      kind: "artifact",
      label: `${saved.title} · version ${version.version}`,
      artifactType: saved.kind,
      path: version.sourcePath,
      contentHash: version.sha256,
      size: version.size,
      meta: {
        artifactStore: true,
        artifactID: saved.id,
        versionID: version.id,
        version: version.version,
        filename: version.filename,
        mimeType: version.mimeType,
        sha256: version.sha256,
        sessionID: version.sessionID,
        sourcePath: version.sourcePath,
        captureQuality: version.captureQuality,
      },
    } as Parameters<typeof Provenance.record>[0])
  }
  if (run) await Provenance.linkOwned(scope, { from: run.id, to: id, relation: "produced" })
}

export const ArtifactTool = Tool.define("artifact", {
  pathFields: ["path"],
  description:
    "Work with project Results: list saved Results, copy a Result back into the workspace, or save a workspace file as a durable Result with a stable identity and immutable versions. Results live outside the workspace, so `list` is the supported way to see what the project has already produced. Empirical contract Results need provenance_id to pass completion. Keep drafts and large mutable working data in the workspace instead.",
  parameters: z.object({
    action: z
      .enum(["list", "copy", "save_file"])
      .describe("list saved Results, copy one into the workspace, or save a workspace file as a Result"),
    path: z
      .string()
      .trim()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Workspace file path. Required for save_file; optional destination for copy"),
    artifact_id: z.string().trim().min(1).optional().describe("Result ID, required for copy"),
    query: z.string().trim().max(200).optional().describe("Optional text filter for list"),
    summary: z.string().optional().describe("Concise user-facing Result title"),
    provenance_id: z
      .string()
      .optional()
      .describe(
        "Producing run provenance ID from this project and session. Required for empirical contract Results to pass completion; may reference a manually recorded run.",
      ),
  }),
  async execute(params, ctx) {
    if (params.action === "list") {
      const all = await ArtifactStore.list(Instance.project.id)
      const needle = params.query?.toLowerCase()
      const items = all
        .filter(
          (item) =>
            !needle ||
            item.title.toLowerCase().includes(needle) ||
            item.current.filename.toLowerCase().includes(needle) ||
            item.kind.toLowerCase().includes(needle),
        )
        .sort((left, right) => right.updatedAt - left.updatedAt)
      const lines = items.map(
        (item) =>
          `- ${item.title} [${item.kind}] id=${item.id} version=${item.current.version} of ${item.versionCount} file=${item.current.filename} size=${item.current.size}B mime=${item.current.mimeType}`,
      )
      return result(
        `Project Results (${items.length})`,
        [
          items.length
            ? `${items.length} Result${items.length === 1 ? "" : "s"} saved in this project (newest first):`
            : needle
              ? `No Result matches "${params.query}".`
              : "This project has no saved Results yet.",
          ...lines,
          "",
          "These are the same Results the user sees in the Results panel. Use `copy` with an id to bring one back into the workspace for further analysis.",
        ].join("\n"),
        {
          results: items.map((item) => ({
            id: item.id,
            title: item.title,
            kind: item.kind,
            version: item.current.version,
            versionCount: item.versionCount,
            filename: item.current.filename,
            mimeType: item.current.mimeType,
            size: item.current.size,
            updatedAt: item.updatedAt,
          })),
        },
      )
    }
    if (params.action === "copy") {
      if (!params.artifact_id) return result("Missing artifact_id", "`copy` needs the Result id returned by `list`.")
      const stored = await ArtifactStore.read(Instance.project.id, params.artifact_id)
      if (!stored) {
        return result("Result not found", `No readable Result with id ${params.artifact_id} in this project.`)
      }
      const root = path.resolve(await SessionFilesystem.workspace(ctx.sessionID))
      const destination = path.resolve(root, params.path ?? path.join("results", stored.info.filename))
      if (destination !== root && !destination.startsWith(root + path.sep)) {
        return result("Invalid destination", "The destination must stay inside the project workspace.")
      }
      try {
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await Bun.write(destination, stored.content)
      } catch (error) {
        return result("Copy failed", error instanceof Error ? error.message : String(error))
      }
      const relative = path.relative(root, destination)
      return result(
        `Copied Result: ${relative}`,
        [
          `Copied "${stored.info.filename}" from Result ${params.artifact_id} (version ${stored.info.version}) into the workspace.`,
          `  Path: ${relative}`,
          `  Size: ${stored.info.size} bytes`,
          `  SHA-256: ${stored.info.sha256}`,
          "",
          "The workspace copy is mutable; the Result itself stays immutable and versioned.",
        ].join("\n"),
        {
          copied: {
            artifactID: params.artifact_id,
            version: stored.info.version,
            path: relative,
            size: stored.info.size,
            sha256: stored.info.sha256,
          },
        },
      )
    }
    if (!params.path) return result("Missing path", "`save_file` needs the workspace file path to save.")
    const node = params.provenance_id
      ? await Provenance.find(
          {
            projectID: Instance.project.id,
            directory: Instance.directory,
          },
          params.provenance_id,
        )
      : undefined
    const entry = runnable(node) ? node : undefined
    const sessionID =
      entry?.sessionID ?? (typeof entry?.meta?.sessionID === "string" ? entry.meta.sessionID : undefined)
    const owner =
      entry?.provenance?.identity.project_id.status === "available"
        ? entry.provenance.identity.project_id.value
        : typeof entry?.meta?.projectID === "string"
          ? entry.meta.projectID
          : undefined
    if (params.provenance_id && (!entry || sessionID !== ctx.sessionID || owner !== Instance.project.id)) {
      return result("Invalid provenance", "The producing run was not found in this project and session.")
    }
    {
      const file = await File.rawSource(params.path, {
        sessionID: ctx.sessionID,
        maxBytes: ArtifactStore.MAX_VERSION_BYTES,
      })
      const name = path.basename(params.path)
      const classified = ArtifactFile.classify(name)
      const title = params.summary?.trim() || name
      const saved = await ArtifactStore.save({
        projectID: Instance.project.id,
        sessionID: ctx.sessionID,
        sourcePath: params.path,
        filename: name,
        kind: classified?.kind ?? "file",
        content: file,
        title,
        mimeType: file.mimeType,
        messageID: ctx.messageID,
        captureQuality: "declared",
        ...(entry ? { execution: savedExecution(entry) } : {}),
      }).finally(() => file.close())
      await traceSavedArtifact(saved, entry).catch((error) => {
        if (entry) throw error
        log.warn("saved Result has no provenance target", {
          sessionID: ctx.sessionID,
          artifactID: saved.id,
          versionID: saved.currentVersionID,
          error,
        })
      })
      return result(
        `Saved Result: ${saved.title}`,
        [
          "Workspace file saved as a durable Result with an immutable version.",
          `  ID: ${saved.id}`,
          `  Version: ${saved.current.version}`,
          `  Kind: ${saved.kind}`,
          `  Path: ${saved.current.sourcePath}`,
          `  Size: ${saved.current.size} bytes`,
          `  SHA-256: ${saved.current.sha256}`,
          "",
          "The Result is available project-wide in Files and can be opened, reviewed, renamed, versioned, or downloaded.",
        ].join("\n"),
        {
          savedArtifact: {
            id: saved.id,
            versionID: saved.currentVersionID,
            version: saved.current.version,
            title: saved.title,
            kind: saved.kind,
            path: saved.current.sourcePath,
            mimeType: saved.current.mimeType,
            size: saved.current.size,
            sha256: saved.current.sha256,
            ...(entry ? { provenanceID: entry.id } : {}),
          },
        },
      )
    }
  },
})
