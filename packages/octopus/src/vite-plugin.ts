import type { Plugin } from "vite"

export const WORKBENCH_VENDOR_PREFIX = "/workbench/assets/vendor"

const VENDOR_URLS: Record<string, string> = {
  react: `${WORKBENCH_VENDOR_PREFIX}/react.js`,
  "react-dom": `${WORKBENCH_VENDOR_PREFIX}/react-dom.js`,
  "react-dom/client": `${WORKBENCH_VENDOR_PREFIX}/react-dom-client.js`,
  "react/jsx-runtime": `${WORKBENCH_VENDOR_PREFIX}/jsx-runtime.js`,
  "octopus-ui": `${WORKBENCH_VENDOR_PREFIX}/octopus-ui.js`,
}

export function octopusVendor(): Plugin {
  return {
    name: "octopus-vendor",
    enforce: "pre",
    resolveId(source, _importer, options) {
      if (options?.isEntry) return null
      const importer = String(_importer ?? "")
      if (/[\\/]src[\\/]vendor[\\/]/.test(importer)) return null
      if (source in VENDOR_URLS) {
        return { id: VENDOR_URLS[source], external: true }
      }
      if (/^react(-dom)?(\/|$)/.test(source)) {
        throw new Error(`[octopus-vendor] 未映射的 react 导入: ${source}（vendor 契约仅支持 react、react-dom、react/jsx-runtime）`)
      }
      return null
    },
    // vite 会把站内绝对 vendor URL 改写为相对路径（误解析），这里统一兜底修正
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue
        const fixed = item.code.replace(/((?:\.\.\/)+)workbench\/assets\/vendor\//g, "/workbench/assets/vendor/")
        if (fixed !== item.code) item.code = fixed
      }
    },
  }
}
