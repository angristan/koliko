import { cloudflare } from "@cloudflare/vite-plugin"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const configPath = process.env.KOLIKO_WRANGLER_CONFIG

export default defineConfig({
  plugins: [
    react(),
    ...cloudflare(configPath ? { configPath } : undefined)
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@cloudflare/kumo") || id.includes("node_modules/@base-ui") || id.includes("node_modules/@phosphor-icons")) return "ui"
          if (id.includes("node_modules/effect")) return "effect"
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react"
          return undefined
        }
      }
    }
  }
})
