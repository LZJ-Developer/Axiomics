export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { AxiomicsClient } from "./gen/sdk.gen.js"
export { type Config as AxiomicsClientConfig, AxiomicsClient }

export function createAxiomicsClient(config?: Config & { directory?: string; projectID?: string; project?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-axiomics-directory": config.directory,
    }
  }

  const project = config?.projectID ?? config?.project
  if (project) {
    config.headers = {
      ...config.headers,
      "x-axiomics-project": project,
    }
  }

  const client = createClient(config)
  return new AxiomicsClient({ client })
}
