import { describe, expect, it, vi } from "vitest"
import { apply } from "./index.js"
import { BASE_PATH } from "./api.js"

function mockContext(openImpl: () => Promise<unknown>) {
  const registered: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
  let disposeAll: (() => void) | undefined
  const dispose = vi.fn()
  const ctx: any = {
    webServer: { register: vi.fn((route: (typeof registered)[number]) => { registered.push(route); return dispose }) },
    storageDomain: { open: vi.fn(openImpl) },
    workspaceRegistry: { create: vi.fn() },
    effect: vi.fn((factory: () => () => void) => { disposeAll = factory() }),
  }
  return { ctx, registered, dispose, getDisposeAll: () => disposeAll }
}

function resCollector() {
  const calls: { status: number; body: string }[] = []
  return {
    calls,
    writeHead(status: number) { calls.push({ status, body: "" }) },
    end(body?: string | Uint8Array) { if (calls.length > 0) calls[calls.length - 1].body += String(body ?? "") },
  }
}

const fakeDomain = {
  table: () => ({
    get: () => undefined,
    entries: () => new Map().entries(),
    put: async () => {},
    delete: async () => true,
  }),
}

describe("apply", () => {
  it("registers prefix route backed by storage domain", async () => {
    const { ctx, registered } = mockContext(() => Promise.resolve(fakeDomain))
    await apply(ctx, { defaultWorkspaceRoot: "~/proj-root" })
    expect(ctx.storageDomain.open).toHaveBeenCalledTimes(1)
    expect(registered).toHaveLength(1)
    expect(registered[0].kind).toBe("prefix")
    expect(registered[0].path).toBe(BASE_PATH)
    const res = resCollector()
    await registered[0].handler({ method: "GET", url: `${BASE_PATH}/config`, on() {} }, res)
    expect(res.calls[0].status).toBe(200)
    expect(JSON.parse(res.calls[0].body).defaultWorkspaceRoot).toContain("proj-root")
  })

  it("dispose closes route and domain", async () => {
    const domainClose = vi.fn()
    const { ctx, dispose, getDisposeAll } = mockContext(() => Promise.resolve({ ...fakeDomain, close: domainClose }))
    await apply(ctx, {})
    getDisposeAll()?.()
    expect(dispose).toHaveBeenCalled()
    expect(domainClose).toHaveBeenCalled()
  })

  it("degrades to 503 placeholder when storage open fails", async () => {
    const { ctx, registered } = mockContext(() => Promise.reject(new Error("storage down")))
    await apply(ctx, {})
    expect(registered).toHaveLength(1)
    const res = resCollector()
    await registered[0].handler({ method: "GET", url: `${BASE_PATH}/projects`, on() {} }, res)
    expect(res.calls[0].status).toBe(503)
  })

  it("does nothing without webServer", async () => {
    const { ctx, registered, getDisposeAll } = mockContext(() => Promise.resolve(fakeDomain))
    ctx.webServer = undefined
    await apply(ctx, {})
    expect(registered).toHaveLength(0)
    expect(getDisposeAll()).toBeUndefined()
  })
})
