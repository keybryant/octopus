import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { octopusVendor } from "octopus/vite"

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
