import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { createRegistry, type WorkbenchRegistry } from "./workbench.js"
import { serveStaticFiles, type HttpRequest, type HttpResponse } from "./static.js"
import { WORKBENCH_VENDOR_PREFIX } from "./vite-plugin.js"

export { serveStaticFiles } from "./static.js"
export type { HttpRequest, HttpResponse } from "./static.js"
export { octopusVendor, WORKBENCH_VENDOR_PREFIX } from "./vite-plugin.js"
export type { WorkbenchModule, WorkbenchRegistry } from "./workbench.js"

export const name = "octopus"
export const inject = ["webServer"]

export const DEFAULT_CONFIG = { title: "My Workbench", greeting: "" }

export const Config = z.object({
  title: z.string().default(DEFAULT_CONFIG.title),
  greeting: z.string().default(DEFAULT_CONFIG.greeting),
})

export function resolveConfig(config: Partial<typeof DEFAULT_CONFIG> = {}): typeof DEFAULT_CONFIG {
  return { ...DEFAULT_CONFIG, ...config }
}

export interface WebServerRoute {
  kind: "exact" | "prefix"
  path: string
  handler: (req: HttpRequest, res: HttpResponse) => Promise<void>
}

export interface WebServerLike {
  register(route: WebServerRoute): () => void
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    workbench: WorkbenchRegistry
    webServer: WebServerLike
  }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(HERE, "..", "web-dist")

function jsonHandler(getValue: () => unknown) {
  return async function (_req: HttpRequest, res: HttpResponse) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    res.end(JSON.stringify(getValue()))
  }
}

export function createIndexHandler(distDir: string) {
  let cached: string | null = null
  return async function serveIndex(_req: HttpRequest, res: HttpResponse) {
    if (cached === null) {
      try {
        cached = await readFile(join(distDir, "index.html"), "utf8")
      } catch {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
        res.end("[octopus] web-dist 未构建：请在 packages/octopus 运行 pnpm build")
        return
      }
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(cached)
  }
}

const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"

export function apply(ctx: Context, config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const effective = resolveConfig(config)
  const registry = createRegistry()
  ctx.provide("workbench", registry)
  ctx.effect(() => {
    const serveIndex = createIndexHandler(DIST_DIR)
    const disposers = [
      ctx.webServer.register({ kind: "exact", path: "/workbench/", handler: serveIndex }),
      ctx.webServer.register({ kind: "exact", path: "/workbench", handler: serveIndex }),
      ctx.webServer.register({
        kind: "prefix",
        path: WORKBENCH_VENDOR_PREFIX,
        handler: serveStaticFiles(join(DIST_DIR, "vendor"), WORKBENCH_VENDOR_PREFIX),
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/workbench/assets",
        handler: serveStaticFiles(join(DIST_DIR, "assets"), "/workbench/assets", {
          cacheControl: ASSET_CACHE_CONTROL,
        }),
      }),
      ctx.webServer.register({ kind: "exact", path: "/api/octopus/config", handler: jsonHandler(() => effective) }),
      ctx.webServer.register({ kind: "exact", path: "/api/octopus/modules", handler: jsonHandler(() => registry.list()) }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

export default { name, inject, Config, apply }
