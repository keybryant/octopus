import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "@deepseek-ai/cordis"
import { serveStaticFiles } from "octopus"
import { createRequirementApiHandler } from "./routes.js"
import { RequirementStore } from "./store.js"

export const name = "octopus-requirements"
export const inject = ["workbench", "webServer", "storageDomain"]

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(HERE, "..", "web", "dist")

/** 功能插件：需求管理（模块注册 + REST API + 前端 bundle 托管） */
export async function apply(ctx: Context) {
  // 打开需求域（storage-domain 层：内存读 + 写链 + 持久化）
  const store = await RequirementStore.open(ctx)

  ctx.effect(() => {
    const disposers: (() => void)[] = [
      ctx.workbench.register({
        id: "requirements",
        title: "需求管理",
        order: 20,
        entry: "/octopus/requirements/assets/index.js",
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/api/octopus-requirements",
        handler: createRequirementApiHandler(store),
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/octopus/requirements/assets",
        handler: serveStaticFiles(DIST_DIR, "/octopus/requirements/assets"),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
      void store.close()
    }
  })
}

export default { name, inject, apply }
