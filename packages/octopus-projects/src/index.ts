import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import {
  BASE_PATH,
  createProjectsHandler,
  type ApiRequest,
  type ProjectsApiDeps,
} from "./api.js"
import {
  DEFAULT_CONFIG,
  projectsDomainSpec,
  resolveDefaultWorkspaceRoot,
} from "./domain.js"

export { DEFAULT_CONFIG }

declare module "@deepseek-ai/cordis" {
  interface Context {
    storageDomain: import("@deepseek-ai/dsh-storage-domain").DomainFacility
    workspaceRegistry: import("@deepseek-ai/dsh-workspace").WorkspaceRegistry
  }
}

export const name = "octopus-projects"
export const inject = ["webServer", "storageDomain", "workspaceRegistry"]

export const Config = z.object({
  defaultWorkspaceRoot: z.string().default(DEFAULT_CONFIG.defaultWorkspaceRoot),
})

export async function apply(ctx: Context, config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const root = resolveDefaultWorkspaceRoot(config.defaultWorkspaceRoot)
  const webServer = ctx.webServer
  if (!webServer) return

  let deps: ProjectsApiDeps
  let domain: import("@deepseek-ai/dsh-storage-domain").Domain<typeof projectsDomainSpec>
  try {
    domain = await ctx.storageDomain.open(projectsDomainSpec)
    const table = domain.table("projects")
    deps = {
      defaultRoot: root,
      projects: {
        get: (id) => table.get(id),
        entries: () => table.entries(),
        put: async (id, value) => { await table.put(id, value) },
        delete: async (id) => await table.delete(id),
      },
      workspaces: {
        create: (path, title) => ctx.workspaceRegistry.create(path, title),
      },
    }
  } catch (err) {
    console.error("[octopus-projects] storage domain open failed:", err)
    ctx.effect(() =>
      webServer.register({
        kind: "prefix",
        path: BASE_PATH,
        handler: async (_req: unknown, res: import("octopus").HttpResponse) => {
          res.writeHead(503, { "content-type": "application/json; charset=utf-8" })
          res.end(JSON.stringify({ error: "[octopus-projects] 存储域未就绪" }))
        },
      }),
    )
    return
  }

  const handler = createProjectsHandler(deps)
  ctx.effect(() => {
    const disposeRoute = webServer.register({
      kind: "prefix",
      path: BASE_PATH,
      handler: (req: unknown, res: unknown) => handler(req as ApiRequest, res as import("octopus").HttpResponse),
    })
    return () => {
      disposeRoute()
      void domain.close()
    }
  })
}
