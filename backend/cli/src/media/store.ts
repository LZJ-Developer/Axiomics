import fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import path from "node:path"
import z from "zod"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { DataRootBarrier } from "@/global/data-root-barrier"
import { detectImageMime, readImageDimensions } from "@/util/image"
import type { MessageV2 } from "@/session/message-v2"

export namespace MediaStore {
  export const PREFIX = "axiomics-media://"
  export const MAX_BYTES = 64 * 1024 * 1024

  const Record = z.object({
    id: z.string().regex(/^med_[0-9a-f]{32}$/),
    mime: z.string(),
    size: z.number().int().nonnegative(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    path: z.string(),
    origin: z.enum(["upload", "read", "python", "r", "generated"]),
    projectID: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
    filename: z.string().optional(),
    createdAt: z.number().int(),
  })
  export type Record = z.infer<typeof Record>

  const cache = new Map<string, Record>()
  const id = () => `med_${crypto.randomUUID().replaceAll("-", "")}`
  const key = (projectID: string, mediaID: string) => ["media", projectID, mediaID]
  const bytesPath = (projectID: string, mediaID: string) => path.join(Global.Path.data, "media", projectID, mediaID)
  const recordPath = (projectID: string, mediaID: string) =>
    path.join(Global.Path.data, "storage", "media", projectID, `${mediaID}.json`)

  export function uri(mediaID: string) {
    return `${PREFIX}${mediaID}`
  }

  export function parse(value: string) {
    if (!value.startsWith(PREFIX)) return
    const mediaID = value.slice(PREFIX.length)
    return /^med_[0-9a-f]{32}$/.test(mediaID) ? mediaID : undefined
  }

  export async function capture(input: {
    bytes: Uint8Array
    mime: string
    origin: Record["origin"]
    sessionID: string
    messageID: string
    filename?: string
  }) {
    if (input.bytes.byteLength > MAX_BYTES) {
      throw new Error(`Media exceeds the ${MAX_BYTES}-byte local limit`)
    }
    const mediaID = id()
    const target = bytesPath(Instance.project.id, mediaID)
    const actual = detectImageMime(input.bytes)
    const mime = actual ?? input.mime
    const dimensions = readImageDimensions(input.bytes)
    const record = Record.parse({
      id: mediaID,
      mime,
      size: input.bytes.byteLength,
      ...(dimensions ?? {}),
      path: target,
      origin: input.origin,
      projectID: Instance.project.id,
      sessionID: input.sessionID,
      messageID: input.messageID,
      ...(input.filename ? { filename: input.filename } : {}),
      createdAt: Date.now(),
    })
    await using operation = await DataRootBarrier.enter(target)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
    await Bun.write(temporary, input.bytes)
    await fs.rename(temporary, target).catch(async (error) => {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    })
    await Storage.write(key(record.projectID, mediaID), record).catch(async (error) => {
      await fs.rm(target, { force: true }).catch(() => undefined)
      throw error
    })
    cache.set(mediaID, record)
    return record
  }

  export async function capturePart(part: MessageV2.FilePart, origin: Record["origin"]): Promise<MessageV2.FilePart> {
    if (!part.mime.startsWith("image/") || parse(part.url)) return part
    if (!part.url.startsWith("data:") || !part.url.includes(",")) return part
    const comma = part.url.indexOf(",")
    const record = await capture({
      bytes: Buffer.from(part.url.slice(comma + 1), "base64"),
      mime: part.mime,
      origin,
      sessionID: part.sessionID,
      messageID: part.messageID,
      filename: part.filename,
    })
    return { ...part, mime: record.mime, url: uri(record.id) }
  }

  export async function get(mediaID: string) {
    const cached = cache.get(mediaID)
    if (cached?.projectID === Instance.project.id) return cached
    const record = Record.parse(await Storage.read<Record>(key(Instance.project.id, mediaID)))
    cache.set(mediaID, record)
    return record
  }

  export function getSync(mediaID: string) {
    const cached = cache.get(mediaID)
    if (cached?.projectID === Instance.project.id) return cached
    const record = Record.parse(JSON.parse(readFileSync(recordPath(Instance.project.id, mediaID), "utf8")))
    cache.set(mediaID, record)
    return record
  }

  export async function read(mediaID: string) {
    const record = await get(mediaID)
    return { record, bytes: new Uint8Array(await Bun.file(record.path).arrayBuffer()) }
  }

  export function dataUrlSync(value: string) {
    const mediaID = parse(value)
    if (!mediaID) return value
    const record = getSync(mediaID)
    return `data:${record.mime};base64,${readFileSync(record.path).toString("base64")}`
  }

  export async function removeSession(projectID: string, sessionID: string) {
    const records = await Storage.list(["media", projectID])
    for (const item of records) {
      const record = await Storage.read<Record>(item).catch(() => undefined)
      if (!record || record.sessionID !== sessionID) continue
      await fs.rm(record.path, { force: true })
      await Storage.remove(item)
      cache.delete(record.id)
    }
  }
}
