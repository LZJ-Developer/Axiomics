import crypto from "crypto"

declare const AXIOMICS_K1: string
declare const AXIOMICS_K2: string
declare const AXIOMICS_K3: string
declare const AXIOMICS_K4: string

function getKey(): Buffer {
  const fragments = [AXIOMICS_K1, AXIOMICS_K2, AXIOMICS_K3, AXIOMICS_K4].map((f) => Buffer.from(f, "base64"))
  const key = Buffer.alloc(32)
  for (const frag of fragments) {
    for (let i = 0; i < 32; i++) key[i] ^= frag[i]
  }
  return key
}

let cachedKey: Buffer | undefined

export function _d(ciphertext: string, iv: string, tag: string): string {
  cachedKey ??= getKey()
  const decipher = crypto.createDecipheriv("aes-256-gcm", cachedKey, Buffer.from(iv, "base64"))
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  let decrypted = decipher.update(ciphertext, "base64", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}
