import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { createRegistry, type WorkbenchRegistry } from "./workbench.js"
import { serveStaticFiles, type HttpRequest, type HttpResponse } from "./static.js"

export { serveStaticFiles, MIME_TYPES } from "./static.js"
export type { HttpRequest, HttpResponse } from "./static.js"
export type { WorkbenchModule, WorkbenchRegistry } from "./workbench.js"

export const name = "octopus"
export const inject = ["webServer"]

export const Config = z.object({
  title: z.string().default("My Workbench"),
  greeting: z.string().default(""),
})

export const DEFAULT_CONFIG = { title: "My Workbench", greeting: "" }

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

async function serveIndex(_req: HttpRequest, res: HttpResponse) {
  try {
    const html = await readFile(join(DIST_DIR, "index.html"), "utf8")
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
  } catch {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
    res.end("[octopus] web-dist 未构建：请在 packages/octopus 运行 pnpm build")
  }
}

export function apply(ctx: Context, config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const effective = resolveConfig(config)
  const registry = createRegistry()
  ctx.provide("workbench", registry)
  const webServer = (ctx.webServer ?? ctx.get?.("webServer")) as WebServerLike | undefined
  if (!webServer) return
  ctx.effect(() => {
    const disposers = [
      webServer.register({ kind: "exact", path: "/workbench", handler: serveIndex }),
      webServer.register({
        kind: "prefix",
        path: "/workbench/assets",
        handler: serveStaticFiles(DIST_DIR, "/workbench/assets"),
      }),
      webServer.register({ kind: "exact", path: "/api/octopus/config", handler: jsonHandler(() => effective) }),
      webServer.register({ kind: "exact", path: "/api/octopus/modules", handler: jsonHandler(() => registry.list()) }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

export default { name, inject, Config, apply }
