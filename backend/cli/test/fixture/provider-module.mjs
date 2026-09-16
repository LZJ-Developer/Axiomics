import { writeFileSync } from "fs"

export function createProbe() {
  const marker = process.env.AXIOMICS_TEST_PROVIDER_MODULE_MARKER
  if (marker) writeFileSync(marker, "created")
  return {
    languageModel(id) {
      return { id }
    },
  }
}
