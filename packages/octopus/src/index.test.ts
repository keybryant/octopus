import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { apply, resolveConfig } from "./index.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const hasDist = existsSync(join(HERE, "..", "web-dist", "index.html"))

function mockContext() {
  const disposers: (() => void)[] = []
  const register = vi.fn(() => {
    const dispose = vi.fn()
    disposers.push(dispose)
    return dispose
  })
  const webServer = { register }
  let disposeAll: (() => void) | undefined
  const ctx: any = {
    provide: vi.fn(),
    get: vi.fn(() => webServer),
    webServer,
    effect: vi.fn((factory: () => () => void) => {
      disposeAll = factory()
    }),
  }
  return { ctx, webServer, disposers, getDisposeAll: () => disposeAll }
}

describe("resolveConfig", () => {
  it("returns defaults when config is empty", () => {
    expect(resolveConfig({})).toEqual({ title: "My Workbench", greeting: "" })
  })

  it("merges partial config over defaults", () => {
    expect(resolveConfig({ title: "我的工作台" })).toEqual({ title: "我的工作台", greeting: "" })
  })
})

describe("apply", () => {
  it("provides the workbench service", () => {
    const { ctx } = mockContext()
    apply(ctx, {})
    expect(ctx.provide).toHaveBeenCalledWith("workbench", expect.objectContaining({
      register: expect.any(Function),
      list: expect.any(Function),
    }))
  })

  it("registers the six routes", () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, {})
    const paths = webServer.register.mock.calls.map(([route]: any[]) => [route.kind, route.path])
    expect(paths).toEqual([
      ["exact", "/workbench/"],
      ["exact", "/workbench"],
      ["prefix", "/workbench/assets/vendor"],
      ["prefix", "/workbench/assets"],
      ["exact", "/api/octopus/config"],
      ["exact", "/api/octopus/modules"],
    ])
  })

  it("serves config and modules JSON from the api routes", async () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, { title: "我的工作台", greeting: "欢迎" })
    const registry = ctx.provide.mock.calls[0][1]
    registry.register({ id: "demo", title: "Demo", entry: "/demo.js" })
    const configRoute = webServer.register.mock.calls[4][0]
    const modulesRoute = webServer.register.mock.calls[5][0]
    const res: any = { calls: [], writeHead(s: number, h: any) { this.calls.push({ s, h, body: "" }) }, end(b: string) { this.calls[this.calls.length - 1].body += b } }
    await configRoute.handler({ method: "GET", url: "/api/octopus/config" }, res)
    expect(res.calls[0].s).toBe(200)
    expect(JSON.parse(res.calls[0].body)).toEqual({ title: "我的工作台", greeting: "欢迎" })
    await modulesRoute.handler({ method: "GET", url: "/api/octopus/modules" }, res)
    expect(res.calls[1].s).toBe(200)
    expect(JSON.parse(res.calls[1].body).map((m: any) => m.id)).toEqual(["demo"])
  })

  it("returns 503 with build hint when web-dist is missing", async () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, {})
    const route = webServer.register.mock.calls[0][0]
    const res: any = { calls: [], writeHead(s: number, h: any) { this.calls.push({ s, h, body: "" }) }, end(b: string) { this.calls[this.calls.length - 1].body += b } }
    await route.handler({ method: "GET", url: "/workbench" }, res)
    if (hasDist) {
      expect(res.calls[0].s).toBe(200)
    } else {
      expect(res.calls[0].s).toBe(503)
      expect(res.calls[0].body).toContain("web-dist")
    }
  })

  it("disposes all route registrations", () => {
    const { ctx, disposers, getDisposeAll } = mockContext()
    apply(ctx, {})
    const disposeAll = getDisposeAll()!
    expect(disposeAll).toBeDefined()
    disposeAll()
    for (const dispose of disposers) expect(dispose).toHaveBeenCalled()
  })
})
