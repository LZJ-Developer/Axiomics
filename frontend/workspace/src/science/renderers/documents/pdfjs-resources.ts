const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`

export const withPdfResources = (source: Record<string, unknown>) => ({
  ...source,
  cMapUrl: `${base}pdfjs/cmaps/`,
  cMapPacked: true,
})
