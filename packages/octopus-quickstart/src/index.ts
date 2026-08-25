import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "@deepseek-ai/cordis"
import { serveStaticFiles } from "octopus"

export const name = "octopus-quickstart"
export const inject = ["workbench", "webServer"]

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(HERE, "..", "web", "dist")

export function apply(ctx: Context) {
  ctx.effect(() => {
    const disposers = [
      ctx.workbench.register({
        id: "quickstart",
        title: "快捷入口",
        order: 10,
        entry: "/octopus/quickstart/assets/index.js",
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/octopus/quickstart/assets",
        handler: serveStaticFiles(DIST_DIR, "/octopus/quickstart/assets"),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

export default { name, inject, apply }
