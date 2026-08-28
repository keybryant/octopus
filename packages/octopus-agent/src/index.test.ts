import { describe, expect, it, vi } from "vitest"
import { Config, apply, inject, name } from "./index.js"
import { BASE_PATH } from "./api.js"

function fakeReq(method: string, url: string, body?: unknown) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)
  return {
    method,
    url,
    on(event: string, listener: (...args: unknown[]) => void): unknown {
      if (event === "data") listener(text)
      if (event === "end") listener()
      return 0
    },
  }
}

function fakeRes() {
  const chunks: string[] = []
  let code = 200
  return {
    res: {
      writeHead: vi.fn((status: number) => { code = status; return 0 }),
      write: vi.fn((chunk: string) => { chunks.push(String(chunk)); return true }),
      end: vi.fn((body?: string) => { if (body !== undefined) chunks.push(String(body)) }),
      on: vi.fn(),
    },
    code: () => code,
    text: () => chunks.join(""),
  }
}

function stubAgents() {
  return {
    create: vi.fn(async () => { throw new Error("no loop") }),
    resume: vi.fn(async () => { throw new Error("no loop") }),
  }
}

function stubPersistence() {
  return { load: vi.fn(), listSnapshots: vi.fn(async () => []) }
}

function stubCtx(services: Record<string, unknown>) {
  const effectFn = vi.fn((fn: () => unknown) => {
    const disposer = fn()
    return typeof disposer === "function" ? (disposer as () => void) : () => {}
  })
  const ctx = {
    on: vi.fn(),
    effect: effectFn,
    provide: vi.fn(),
    plugin: vi.fn(),
    get: vi.fn((key: string) => services[key]),
  }
  return { ctx: ctx as never, effect: effectFn }
}

type Route = { kind: string; path: string; handler: (req: never, res: never) => Promise<void> }

describe("octopus-agent plugin", () => {
  it("declares plugin identity and webServer inject", () => {
    expect(name).toBe("octopus-agent")
    expect(inject).toEqual(["webServer", "agents"])
  })
  it("config has defaults", () => {
    const cfg = Config()
    expect(cfg.defaultAgentPreset).toBe("standard")
    expect(cfg.idleTtlMs).toBe(30 * 60 * 1000)
  })
})

describe("octopus-agent plugin apply", () => {
  it("registers api route and threads agentDefaultModel defaults through agentOptions", async () => {
    const webServer = { register: vi.fn((route: unknown) => () => {}) }
    const agents = stubAgents()
    const defaultModel = { currentSelection: vi.fn(() => ({ provider: "dm-provider", model: "dm-model" })) }
    const { ctx, effect } = stubCtx({
      webServer,
      agents,
      sessionPersistence: stubPersistence(),
      agentDefaultModel: defaultModel,
      userQuestions: undefined,
    })
    await (apply as (c: typeof ctx, config: unknown) => Promise<void>)(ctx, Config())
    expect(effect).toHaveBeenCalled()
    expect(webServer.register).toHaveBeenCalledTimes(1)
    const route = webServer.register.mock.calls[0][0] as Route
    expect(route).toMatchObject({ kind: "prefix", path: BASE_PATH })
    const res = fakeRes()
    await route.handler(fakeReq("POST", `${BASE_PATH}/sessions`, { cwd: "/x" }) as never, res.res as never)
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^oct-[A-Z2-7]{8}$/),
      meta: expect.objectContaining({ cwd: "/x", agentPreset: "standard" }),
      agentOptions: { provider: "dm-provider", model: "dm-model" },
    }))
    expect(res.code()).toBe(503)
    expect(JSON.parse(res.text())).toMatchObject({ error: "agent create failed: no loop" })
  })

  it("lets configured provider and model override agentDefaultModel selection", async () => {
    const webServer = { register: vi.fn((route: unknown) => () => {}) }
    const agents = stubAgents()
    const defaultModel = { currentSelection: vi.fn(() => ({ provider: "dm-provider", model: "dm-model" })) }
    const { ctx } = stubCtx({
      webServer,
      agents,
      sessionPersistence: stubPersistence(),
      agentDefaultModel: defaultModel,
      userQuestions: undefined,
    })
    await (apply as (c: typeof ctx, config: unknown) => Promise<void>)(ctx, { provider: "cfg-provider", model: "cfg-model" })
    const route = webServer.register.mock.calls[0][0] as Route
    await route.handler(fakeReq("POST", `${BASE_PATH}/sessions`, { cwd: "/x" }) as never, fakeRes().res as never)
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: "cfg-provider", model: "cfg-model" },
    }))
  })

  it("registers a degraded 503 route when sessionPersistence is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const webServer = { register: vi.fn((route: unknown) => () => {}) }
      const { ctx } = stubCtx({ webServer, agents: undefined, sessionPersistence: undefined })
      await (apply as (c: typeof ctx, config: unknown) => Promise<void>)(ctx, Config())
      expect(errorSpy).toHaveBeenCalledWith("[octopus-agent] sessionPersistence unavailable")
      expect(webServer.register).toHaveBeenCalledTimes(1)
      const route = webServer.register.mock.calls[0][0] as Route
      expect(route).toMatchObject({ kind: "prefix", path: BASE_PATH })
      const up = fakeRes()
      await route.handler(fakeReq("GET", `${BASE_PATH}/up`) as never, up.res as never)
      expect(up.code()).toBe(503)
      expect(JSON.parse(up.text())).toEqual({ ok: false })
      const rest = fakeRes()
      await route.handler(fakeReq("GET", `${BASE_PATH}/sessions`) as never, rest.res as never)
      expect(rest.code()).toBe(503)
      expect(JSON.parse(rest.text())).toEqual({ error: "agent service unavailable" })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("does not register a user-questions provider and warns once at boot", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      vi.resetModules()
      const fresh = await import("./index.js")
      const webServer = { register: vi.fn((route: unknown) => () => {}) }
      const agents = stubAgents()
      const registerProvider = vi.fn()
      const { ctx } = stubCtx({
        webServer,
        agents,
        sessionPersistence: stubPersistence(),
        agentDefaultModel: undefined,
        userQuestions: { registerProvider },
      })
      await (fresh.apply as (c: typeof ctx, config: unknown) => Promise<void>)(ctx, Config())
      expect(registerProvider).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith("[octopus-agent] ask_user_question bridge inactive: the web profile owns the global user-questions provider")
      await (fresh.apply as (c: typeof ctx, config: unknown) => Promise<void>)(ctx, Config())
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })
})
