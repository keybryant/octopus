import type { Plugin } from "vite"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const VENDOR = {
  react: "/workbench/assets/vendor/react.js",
  "react-dom": "/workbench/assets/vendor/react-dom.js",
  "react/jsx-runtime": "/workbench/assets/vendor/jsx-runtime.js",
}

function octopusVendor(): Plugin {
  return {
    name: "octopus-vendor",
    enforce: "pre",
    resolveId(source, importer, options) {
      if (options?.isEntry) return null
      if (source in VENDOR) {
        return { id: VENDOR[source as keyof typeof VENDOR], external: true }
      }
      if (/^react(-dom)?(\/|$)/.test(source)) {
        throw new Error(`[octopus-vendor] 未映射的 react 导入: ${source}（请将其加入 VENDOR 映射）`)
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [react(), octopusVendor()],
  build: {
    outDir: "../web/dist",
    emptyOutDir: true,
    lib: {
      entry: "src/index.tsx",
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
      },
    },
  },
})
