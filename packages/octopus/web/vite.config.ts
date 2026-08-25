import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  base: "/workbench/",
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
  },
})
