import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { octopusVendor } from "octopus/vite"

/** lib mode 下把 CSS 内联进 entry JS：壳只 import entry，不加载独立 css 文件 */
function inlineCss(): Plugin {
  return {
    name: "octopus-requirements-inline-css",
    apply: "build",
    generateBundle(_options, bundle) {
      const entries = Object.values(bundle)
      const cssFile = entries.find(
        (item) => item.type === "asset" && item.fileName.endsWith(".css"),
      ) as { type: "asset"; fileName: string; source: string | Uint8Array } | undefined
      const jsChunk = entries.find(
        (item) => item.type === "chunk" && item.fileName.endsWith(".js"),
      ) as { type: "chunk"; fileName: string; code: string } | undefined
      if (!cssFile || !jsChunk) return
      const css =
        typeof cssFile.source === "string"
          ? cssFile.source
          : new TextDecoder().decode(cssFile.source)
      const inject = `(()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})();`
      jsChunk.code = inject + "\n" + jsChunk.code
      delete bundle[cssFile.fileName]
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), octopusVendor(), inlineCss()],
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