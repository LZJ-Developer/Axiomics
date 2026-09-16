export * from "./client.js"
export * from "./server.js"
export * from "./v2/runtime.js"

import { createAxiomicsClient } from "./client.js"
import { createAxiomicsServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createAxiomics(options?: ServerOptions) {
  const server = await createAxiomicsServer({
    ...options,
  })

  const client = createAxiomicsClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
