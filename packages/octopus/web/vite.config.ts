import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { octopusVendor } from "../src/vite-plugin"

export default defineConfig({
  plugins: [react(), octopusVendor(), tailwindcss()],
  base: "/workbench/",
  server: {
    // HMR 开发模式：页面走本 vite server，API 与服务端渲染页代理到已启动的 dsh web（默认 3080）
    proxy: {
      "/api": "http://127.0.0.1:3080",
      "/octopus": "http://127.0.0.1:3080",
      // 登录页是 octopus-auth 服务端渲染的页面，需转发到后端
      "/login": "http://127.0.0.1:3080",
    },
  },
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
  },
})
