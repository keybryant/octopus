import { defineConfig } from "vite"

export default defineConfig({
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
        "jsx-runtime": "src/vendor/jsx-runtime.ts",
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
