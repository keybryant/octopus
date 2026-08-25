import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apply, createIndexHandler, resolveConfig } from "./index.js"
import { WORKBENCH_VENDOR_PREFIX } from "./vite-plugin.js"

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
    webServer,
    effect: vi.fn((factory: () => () => void) => {
      disposeAll = factory()
    }),
  }
  return { ctx, webServer, disposers, getDisposeAll: () => disposeAll }
}

function createRes() {
  const calls: { status: number; headers: Record<string, string>; body: string }[] = []
  return {
    calls,
    writeHead(status: number, headers: Record<string, string> = {}) {
      calls.push({ status, headers, body: "" })
    },
    end(body?: string | Uint8Array) {
      calls[calls.length - 1].body += String(body ?? "")
    },
  }
}

describe("resolveConfig", () => {
  it("returns defaults when config is empty", () => {
    expect(resolveConfig({})).toEqual({ title: "My Workbench", greeting: "" })
  })

  it("merges partial config over defaults", () => {
    expect(resolveConfig({ title: "我的工作台" })).toEqual({ title: "我的工作台", greeting: "" })
  })
})

describe("createIndexHandler", () => {
  let dir = ""

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "octopus-index-"))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("serves index.html with 200 when built", async () => {
    writeFileSync(join(dir, "index.html"), "<html>ok</html>")
    const handler = createIndexHandler(dir)
    const res = createRes()
    await handler({ method: "GET", url: "/workbench" }, res)
    expect(res.calls[0].status).toBe(200)
    expect(res.calls[0].headers["content-type"]).toBe("text/html; charset=utf-8")
    expect(res.calls[0].body).toBe("<html>ok</html>")
  })

  it("returns 503 with build hint when web-dist is missing", async () => {
    const handler = createIndexHandler(join(dir, "missing"))
    const res = createRes()
    await handler({ method: "GET", url: "/workbench" }, res)
    expect(res.calls[0].status).toBe(503)
    expect(res.calls[0].body).toContain("web-dist")
  })

  it("caches the html in memory across requests", async () => {
    writeFileSync(join(dir, "index.html"), "<html>v1</html>")
    const handler = createIndexHandler(dir)
    const res1 = createRes()
    await handler({ method: "GET" }, res1)
    writeFileSync(join(dir, "index.html"), "<html>v2</html>")
    const res2 = createRes()
    await handler({ method: "GET" }, res2)
    expect(res2.calls[0].body).toBe("<html>v1</html>")
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

  function registeredRoutes(webServer: { register: ReturnType<typeof vi.fn> }) {
    return new Map(
      webServer.register.mock.calls.map(([route]: any[]) => [`${route.kind} ${route.path}`, route]),
    )
  }

  it("registers the expected routes", () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, {})
    const routes = registeredRoutes(webServer)
    expect([...routes.keys()].sort()).toEqual([
      "exact /api/octopus/config",
      "exact /api/octopus/modules",
      "exact /workbench",
      "exact /workbench/",
      "prefix /workbench/assets",
      "prefix /workbench/assets/vendor",
    ])
  })

  it("serves config and modules JSON from the api routes", async () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, { title: "我的工作台", greeting: "欢迎" })
    const registry = ctx.provide.mock.calls[0][1]
    registry.register({ id: "demo", title: "Demo", entry: "/demo.js" })
    const routes = registeredRoutes(webServer)
    const res = createRes()
    await routes.get("exact /api/octopus/config")!.handler({ method: "GET", url: "/api/octopus/config" }, res)
    expect(res.calls[0].status).toBe(200)
    expect(JSON.parse(res.calls[0].body)).toEqual({ title: "我的工作台", greeting: "欢迎" })
    await routes.get("exact /api/octopus/modules")!.handler({ method: "GET", url: "/api/octopus/modules" }, res)
    expect(res.calls[1].status).toBe(200)
    expect(JSON.parse(res.calls[1].body).map((m: any) => m.id)).toEqual(["demo"])
  })

  it("shares one cached index handler between /workbench and /workbench/", () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, {})
    const routes = registeredRoutes(webServer)
    expect(routes.get("exact /workbench")!.handler).toBe(routes.get("exact /workbench/")!.handler)
  })

  it("registers the vendor route at the shared contract prefix", () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, {})
    const routes = registeredRoutes(webServer)
    expect(routes.has(`prefix ${WORKBENCH_VENDOR_PREFIX}`)).toBe(true)
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
