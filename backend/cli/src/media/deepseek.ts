import z from "zod"
import { Storage } from "@/storage/storage"
import { CredentialLifecycle } from "@/credentials/lifecycle"
import { MediaStore } from "./store"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

export namespace DeepSeekMedia {
  const log = Log.create({ service: "media.deepseek" })
  const TTL_SECONDS = 30 * 24 * 60 * 60
  const REFRESH_MS = 24 * 60 * 60 * 1000
  const Binding = z.object({
    mediaID: z.string(),
    providerID: z.literal("deepseek"),
    credentialRevision: z.string(),
    fileID: z.string().startsWith("file-api-"),
    expiresAt: z.number().int(),
  })
  export type Binding = z.infer<typeof Binding>

  const uploads = new Map<string, Promise<Binding>>()
  const key = (projectID: string, revision: string, mediaID: string) => [
    "media_binding",
    "deepseek",
    projectID,
    revision,
    mediaID,
  ]

  async function revision() {
    const value = await Bun.file(CredentialLifecycle.revisionPath())
      .json()
      .catch(() => undefined)
    return value && typeof value === "object" && "token" in value && typeof value.token === "string"
      ? value.token
      : "bootstrap"
  }

  async function upload(input: {
    mediaID: string
    revision: string
    baseURL: string
    apiKey: string
    fetch: typeof globalThis.fetch
  }) {
    const storageKey = key(Instance.project.id, input.revision, input.mediaID)
    const cached = await Storage.read<Binding>(storageKey)
      .then((value) => Binding.parse(value))
      .catch(() => undefined)
    if (cached && cached.expiresAt > Date.now() + REFRESH_MS) {
      log.info("reuse file binding", { mediaID: input.mediaID, fileID: cached.fileID })
      return cached
    }
    const identity = `${Instance.project.id}:${input.revision}:${input.mediaID}`
    const pending = uploads.get(identity)
    if (pending) return pending
    const run = (async () => {
      const media = await MediaStore.read(input.mediaID)
      if (!new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]).has(media.record.mime)) {
        throw new Error(`DeepSeek Files does not support ${media.record.mime}`)
      }
      const form = new FormData()
      form.set("purpose", "user_data")
      form.set("expires_after[anchor]", "created_at")
      form.set("expires_after[seconds]", String(TTL_SECONDS))
      form.set(
        "file",
        new Blob([media.bytes], { type: media.record.mime }),
        media.record.filename ?? `${media.record.id}.${media.record.mime.split("/").at(-1) ?? "img"}`,
      )
      const response = await input.fetch(`${input.baseURL.replace(/\/+$/, "")}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}` },
        body: form,
      })
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 1_000)
        throw new Error(`DeepSeek file upload failed (${response.status})${detail ? `: ${detail}` : ""}`)
      }
      const value = z
        .object({ id: z.string().startsWith("file-api-"), expires_at: z.number().int().optional() })
        .parse(await response.json())
      const binding = Binding.parse({
        mediaID: input.mediaID,
        providerID: "deepseek",
        credentialRevision: input.revision,
        fileID: value.id,
        expiresAt: (value.expires_at ?? Math.floor(Date.now() / 1000) + TTL_SECONDS) * 1000,
      })
      await Storage.write(storageKey, binding)
      log.info("uploaded media", {
        mediaID: input.mediaID,
        fileID: binding.fileID,
        mime: media.record.mime,
        bytes: media.record.size,
        expiresAt: binding.expiresAt,
      })
      return binding
    })().finally(() => uploads.delete(identity))
    uploads.set(identity, run)
    return run
  }

  export async function prepare(input: {
    body: unknown
    baseURL: string
    apiKey: string
    fetch: typeof globalThis.fetch
    refresh?: boolean
  }) {
    const current = await revision()
    const refs = new Set<string>()
    const replace = async (value: unknown): Promise<unknown> => {
      if (Array.isArray(value)) return Promise.all(value.map(replace))
      if (!value || typeof value !== "object") return value
      const record = value as Record<string, unknown>
      const mediaID =
        record.type === "input_image" && typeof record.image_url === "string"
          ? MediaStore.parse(record.image_url)
          : undefined
      if (mediaID) {
        refs.add(mediaID)
        if (input.refresh) {
          log.info("refresh file binding", { mediaID })
          await Storage.remove(key(Instance.project.id, current, mediaID)).catch(() => undefined)
        }
        const binding = await upload({
          mediaID,
          revision: current,
          baseURL: input.baseURL,
          apiKey: input.apiKey,
          fetch: input.fetch,
        })
        return { type: "input_image", file_id: binding.fileID }
      }
      const entries = await Promise.all(
        Object.entries(record).map(async (entry) => [entry[0], await replace(entry[1])]),
      )
      return Object.fromEntries(entries)
    }
    return { body: await replace(input.body), refs: [...refs], revision: current }
  }

  export async function isMissing(response: Response) {
    if (response.status !== 400 && response.status !== 404) return false
    const text = await response
      .clone()
      .text()
      .catch(() => "")
    return /file(?:_id)?.*(?:not found|expired|does not exist|invalid)/i.test(text)
  }
}
