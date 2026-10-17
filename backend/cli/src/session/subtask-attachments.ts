import path from "node:path"
import { pathToFileURL } from "node:url"

import { SafeFileIO } from "../file/safe-io"
import { AuthoritySignal } from "../project/authority-signal"
import { SessionFilesystem } from "./filesystem"

/**
 * 把聊天附件落成**磁盘上的文件**，并把引用（不是 base64）交给模型。
 *
 * 为什么需要它：附件原本只以 `data:` URL 的形式存在于消息里。模型能内联看到
 * 前 64,000 字符，工具却打不开——因为磁盘上没有这个文件。组学数据（FASTQ/BAM/
 * h5ad）根本不可能靠内联工作，必须让 agent 拿到一个路径，用工具去读。
 *
 * 移植自上游 synthetic-sciences/openscience：
 *   cf70bd58 fix(attachments): let the agent read a PDF attached to a chat message
 * 上游的 SubtaskAttachments 还包含 snapshot()（委派给子会话用），这里只取落盘这一段。
 */
export namespace SubtaskAttachments {
  export const LIMIT = 32 * 1024 * 1024

  /** 本模块关心的最小附件形状，避免把 MessageV2 的完整类型拖进来。 */
  export type Attachment = { type: "file"; mime: string; filename?: string; url: string }

  function limit(size: number) {
    if (size > LIMIT) throw new Error("Attachments exceed the 32 MiB byte limit. Split or reduce the uploaded files.")
  }

  /** 解码 data URL（含百分号编码），不解码就落盘会把 URL 文本当成文件内容。 */
  export function decode(url: string) {
    if (!url.startsWith("data:")) throw new Error("Attachment is not a data URL")
    const comma = url.indexOf(",")
    if (comma < 0) throw new Error("Invalid attachment data URL")
    const payload = url.slice(comma + 1)
    if (url.slice(0, comma).split(";").includes("base64")) {
      limit(Buffer.byteLength(payload, "base64"))
      const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
      if (payload.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(payload.slice(0, payload.length - padding))) {
        throw new Error("Invalid attachment base64 payload")
      }
      return Buffer.from(payload, "base64")
    }
    // 百分号编码最多三个源字节对应一个解码字节
    if (Buffer.byteLength(payload) > LIMIT * 3) limit(LIMIT + 1)
    const source = Buffer.from(payload)
    const bytes = Buffer.allocUnsafe(Math.min(source.length, LIMIT))
    let count = 0
    for (let index = 0; index < source.length; index++) {
      limit(count + 1)
      if (source[index] !== 37) {
        bytes[count++] = source[index]!
        continue
      }
      const hex = source.subarray(index + 1, index + 3).toString("ascii")
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error("Invalid attachment percent encoding")
      bytes[count++] = Number.parseInt(hex, 16)
      index += 2
    }
    return bytes.subarray(0, count)
  }

  /**
   * 写入会话工作区，返回带 `file://` 引用的附件。
   *
   * 文件名是**内容寻址**的（`<prefix>-<index>-<sha256 前 16 位>-<原名>`）：
   * 同样的字节重复上传落到同一个文件，不会堆积副本；字节变了就会是新名字，
   * 不会静默覆盖上一次的附件。
   */
  export async function materialize(
    attachments: Attachment[],
    sessionID: string,
    signal: AbortSignal,
    prefix = "attachment",
  ) {
    const result: Attachment[] = []
    let size = 0
    for (const [index, part] of attachments.entries()) {
      const bytes = decode(part.url)
      size += bytes.byteLength
      limit(size)

      const name = { value: "", bytes: 0 }
      const basename = path.basename(part.filename ?? "attachment").replace(/[\x00-\x1f\x7f]/g, "_")
      // 保留扩展名，同时给持久化前缀留出字节余量：文件名上限按 UTF-8 字节算，不是字符。
      for (const character of Array.from(basename).reverse()) {
        const width = Buffer.byteLength(character)
        if (name.bytes + width > 160) break
        name.value = character + name.value
        name.bytes += width
      }
      const filename = name.value || "attachment"
      const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

      const target = await AuthoritySignal.exclusive(async () => {
        signal.throwIfAborted()
        const workspace = await SessionFilesystem.workspace(sessionID)
        const destination = path.join(workspace, `${prefix}-${index}-${digest.slice(0, 16)}-${filename}`)
        const previous = await SafeFileIO.optional(destination, { maxBytes: LIMIT })
        signal.throwIfAborted()
        if (previous) {
          if (!previous.bytes.equals(bytes)) throw new Error("An attachment changed before the message was persisted")
        } else {
          await SafeFileIO.write(destination, bytes)
        }
        return destination
      })

      result.push({ type: "file", mime: part.mime, filename: part.filename, url: pathToFileURL(target).href })
    }
    signal.throwIfAborted()
    return result
  }
}
