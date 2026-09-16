import { catalogManifests } from "./catalog"
import { coreManifests } from "./core"
import { bioNemoManifests } from "./bionemo"
import { omicsManifests } from "./omics"

export const capabilityManifests = {
  ...coreManifests,
  ...omicsManifests,
  ...catalogManifests,
  ...bioNemoManifests,
} as const
