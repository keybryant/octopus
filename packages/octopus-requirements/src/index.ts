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
export function apply(ctx: Context) {
  // 打开需求域（storage-domain 层：内存读 + 写链 + 持久化）与资源注册、关闭
  // 统一放进 effect：插件被 dispose 时异步清理会被等待，避免资源泄漏
  ctx.effect(async () => {
    const store = await RequirementStore.open(ctx)

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
    return async () => {
      for (const dispose of disposers) dispose()
      await store.close().catch((error) => {
        console.error("[octopus-requirements] failed to close store", error)
      })
    }
  })
}

export default { name, inject, apply }
