import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "@deepseek-ai/cordis"
import { serveStaticFiles } from "octopus"
import { createTaskApiHandler } from "./routes.js"
import { TaskStore } from "./store.js"

export type { TaskDraft, TaskRecord, TaskStatus } from "./types.js"
export { TASK_STATUS_CHANGED_EVENT } from "./types.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    taskStore: import("./store.js").TaskStore
  }
}

export const name = "octopus-tasks"
export const inject = ["workbench", "webServer", "storageDomain"]

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(HERE, "..", "web", "dist")

/** 功能插件：任务看板（模块注册 + REST API + 前端 bundle 托管） */
export function apply(ctx: Context) {
  ctx.effect(async () => {
    const store = await TaskStore.open(ctx)
    ctx.provide("taskStore", store)

    const disposers: (() => void)[] = [
      ctx.workbench.register({
        id: "tasks",
        title: "任务看板",
        order: 30,
        entry: "/octopus/tasks/assets/index.js",
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/api/octopus-tasks",
        handler: createTaskApiHandler(store),
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/octopus/tasks/assets",
        handler: serveStaticFiles(DIST_DIR, "/octopus/tasks/assets"),
      }),
    ]
    return async () => {
      for (const dispose of disposers) dispose()
      await store.close().catch((error) => {
        console.error("[octopus-tasks] failed to close store", error)
      })
    }
  })
}

export default { name, inject, apply }
