import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/workbench/",
  server: {
    // HMR 开发模式：页面走本 vite server，API 代理到已启动的 dsh web（默认 3080）
    proxy: {
      "/api": "http://127.0.0.1:3080",
      "/octopus": "http://127.0.0.1:3080",
    },
  },
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
  },
})
