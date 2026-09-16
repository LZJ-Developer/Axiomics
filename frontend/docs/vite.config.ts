import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Every asset URL resolves beneath /docs/.
export default defineConfig({
  base: "/docs/",
  plugins: [react()],
  assetsInclude: ["**/*.mdx"],
})
