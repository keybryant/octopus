import type { Plugin } from "vite"

export const WORKBENCH_VENDOR_PREFIX = "/workbench/assets/vendor"

const VENDOR_URLS: Record<string, string> = {
  react: `${WORKBENCH_VENDOR_PREFIX}/react.js`,
  "react-dom": `${WORKBENCH_VENDOR_PREFIX}/react-dom.js`,
  "react-dom/client": `${WORKBENCH_VENDOR_PREFIX}/react-dom-client.js`,
  "react/jsx-runtime": `${WORKBENCH_VENDOR_PREFIX}/jsx-runtime.js`,
}

export function octopusVendor(): Plugin {
  return {
    name: "octopus-vendor",
    enforce: "pre",
    resolveId(source, _importer, options) {
      if (options?.isEntry) return null
      if (source in VENDOR_URLS) {
        return { id: VENDOR_URLS[source], external: true }
      }
      if (/^react(-dom)?(\/|$)/.test(source)) {
        throw new Error(`[octopus-vendor] 未映射的 react 导入: ${source}（vendor 契约仅支持 react、react-dom、react/jsx-runtime）`)
      }
      return null
    },
  }
}
