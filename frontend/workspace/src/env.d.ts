interface ImportMetaEnv {
  readonly VITE_AXIOMICS_VERSION?: string
  readonly VITE_AXIOMICS_SERVER_HOST: string
  readonly VITE_AXIOMICS_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __AXIOMICS_BASE_URL__?: string
}
