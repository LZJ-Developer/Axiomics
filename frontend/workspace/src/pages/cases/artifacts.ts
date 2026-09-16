import { artifactTypeLabel, generatedArtifacts, type SavedArtifact } from "@axiomics/ui/tool-display"
import type { Frame } from "./timeline"

const image = /\.(?:png|jpe?g|webp|gif|tiff?|svg)$/i

export function artifactRank(artifact: SavedArtifact) {
  if (artifactTypeLabel(artifact) === "PDF") return 2
  if (artifact.mimeType?.startsWith("image/") || image.test(artifact.path)) return 1
  return 0
}

export function framePdf(frame: Frame | undefined) {
  if (!frame) return
  return generatedArtifacts(frame.parts)
    .filter((artifact) => artifactRank(artifact) === 2)
    .at(-1)
}

export function bestArtifact(frames: Frame[], cursor = frames.length) {
  return frames
    .slice(0, Math.max(0, Math.min(cursor, frames.length)))
    .flatMap((frame) => generatedArtifacts(frame.parts))
    .filter((artifact) => artifactRank(artifact) > 0)
    .reduce<SavedArtifact | undefined>((best, artifact) => {
      if (!best || artifactRank(artifact) >= artifactRank(best)) return artifact
      return best
    }, undefined)
}
