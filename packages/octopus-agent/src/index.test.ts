import { describe, expect, it, vi, type Mock } from "vitest"
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

  it("bridges user questions through the message endpoint", async () => {
    const webServer = { register: vi.fn((route: unknown) => () => {}) }
    const create = vi.fn(async (options: { sessionId: string }) => {
      return {
        agent: {
          id: options.sessionId,
          status: "idle",
          ctx: { on: vi.fn() },
          followup: vi.fn(),
          cancel: vi.fn(),
        },
        dispose: vi.fn(async () => {}),
      }
    })
    const agents = { create, resume: vi.fn(async () => { throw new Error("no loop") }) }
    const registerProvider = vi.fn()
    const { ctx } = stubCtx({
      webServer,
      agents,
      sessionPersistence: stubPersistence(),
      agentDefaultModel: undefined,
      userQuestions: { registerProvider },
    })
    await (apply as (c: typeof ctx, config: unknown) => Promise<void>)(ctx, Config())
    expect(registerProvider).toHaveBeenCalledTimes(1)
    const ask = registerProvider.mock.calls[0][0] as { ask: Mock<(request: unknown) => Promise<unknown>> }
    const route = webServer.register.mock.calls[0][0] as Route
    const created = fakeRes()
    await route.handler(fakeReq("POST", `${BASE_PATH}/sessions`, { cwd: "/x" }) as never, created.res as never)
    const sessionId = (JSON.parse(created.text()) as { session: { id: string } }).session.id
    const answerPromise = ask.ask({
      agent: { id: sessionId },
      questions: [{ id: "ask-1", question: "go on?", options: ["yes", "no"] }],
    }) as Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>
    const history = fakeRes()
    await route.handler(fakeReq("GET", `${BASE_PATH}/sessions/${sessionId}/history`) as never, history.res as never)
    const events = (JSON.parse(history.text()) as { events: Array<{ type: string; id: string }> }).events
    expect(events[0]).toMatchObject({ type: "question", id: `${sessionId}:q0`, question: "go on?", options: ["yes", "no"] })
    await route.handler(
      fakeReq("POST", `${BASE_PATH}/sessions/${sessionId}/messages`, { text: "yes", answerQuestionId: events[0].id }) as never,
      fakeRes().res as never,
    )
    await expect(answerPromise).resolves.toEqual({ answers: [{ id: "ask-1", selected: [], custom: "yes" }] })
    await expect(ask.ask({ questions: [{ id: "ask-1", question: "q?" }] })).rejects.toThrow("[octopus-agent] question without agent")
  })
})
