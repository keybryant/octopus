import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "@deepseek-ai/cordis"
import { serveStaticFiles } from "octopus"

export const name = "octopus-users-view"
export const inject = ["workbench", "webServer"] as const

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(HERE, "..", "web", "dist")

export function apply(ctx: Context) {
  ctx.effect(() => {
    const disposers = [
      ctx.workbench.register({
        id: "users-view",
        title: "用户管理",
        order: 900,
        entry: "/octopus/users-view/assets/index.js",
        access: "admin",
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/octopus/users-view/assets",
        handler: serveStaticFiles(DIST_DIR, "/octopus/users-view/assets", {
          cacheControl: "public, max-age=31536000, immutable",
        }),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

export default { name, inject, apply }
