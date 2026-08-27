import { defineConfig } from "vite"
import { octopusVendor } from "../src/vite-plugin"

export default defineConfig({
  plugins: [octopusVendor()],
  base: "/workbench/",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "../web-dist/vendor",
    emptyOutDir: false,
    lib: {
      entry: {
        react: "src/vendor/react.ts",
        "react-dom": "src/vendor/react-dom.ts",
        "react-dom-client": "src/vendor/react-dom-client.ts",
        "jsx-runtime": "src/vendor/jsx-runtime.ts",
        "octopus-ui": "src/vendor/octopus-ui.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
})
