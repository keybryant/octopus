import { describe, expect, it, vi, type Mock } from "vitest"
import { createAgentApi, BASE_PATH, type IndexLike, type ApiRequest, type ApiResponse } from "./api.js"
import { ManagerError } from "./manager.js"
import type { AgentStreamEvent, SessionMeta } from "./types.js"

const meta: SessionMeta = { id: "oct-AAAAAAA1", createdAt: "2026-08-28T00:00:00.000Z", cwd: "/x", title: null, live: true }

type StatusLike = { live: boolean; status?: "idle" | "running"; pendingApprovalId?: string }

interface StubManager {
  create: Mock<(input: { cwd?: string; agentPreset?: string; provider?: string; model?: string }) => Promise<SessionMeta>>
  list: Mock<() => Promise<SessionMeta[]>>
  getIndex: Mock<(id: string, opts?: { allowResume?: boolean }) => Promise<IndexLike>>
  getStatus: Mock<(id: string) => StatusLike>
  send: Mock<(id: string, text: string, answerQuestionId?: string) => Promise<void>>
  cancel: Mock<(id: string) => Promise<void>>
  dispose: Mock<(id: string) => Promise<void>>
  answerApproval: Mock<(id: string, approvalId: string, decision: "allow" | "deny") => Promise<void>>
}

function fakeReq(method: string, url: string, body?: unknown): { req: ApiRequest; emitClose: () => void } {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)
  let closeListener: (() => void) | undefined
  const req: ApiRequest = {
    method,
    url,
    on(event: string, listener: (...args: unknown[]) => void): unknown {
      if (event === "data") listener(text)
      if (event === "end") listener()
      if (event === "close") closeListener = listener as () => void
      return 0
    },
  }
  return { req, emitClose: () => closeListener?.() }
}

function fakeRes() {
  const chunks: string[] = []
  let code = 200
  const res = {
    writeHead: vi.fn((status: number) => { code = status; return 0 }),
    write: vi.fn((chunk: string) => { chunks.push(String(chunk)); return true }),
    end: vi.fn((body?: string) => { if (body !== undefined) chunks.push(String(body)) }),
    on: vi.fn(),
    chunks,
  }
  return {
    res: res as unknown as ApiResponse & { chunks: string[]; write: ReturnType<typeof vi.fn> },
    code: () => code,
    text: () => chunks.join(""),
    writes: () => res.write.mock.calls.map(([chunk]) => String(chunk)),
  }
}

function makeStub(overrides: Partial<StubManager> = {}) {
  const events: AgentStreamEvent[] = [
    { idx: 0, type: "user-message", text: "hi" },
    { idx: 1, type: "assistant-text", text: "yo" },
  ]
  const index = {
    list: vi.fn((from = 0) => events.slice(from)),
    get lastIdx() { return events.length - 1 },
  }
  const manager: StubManager = {
    create: vi.fn(async () => ({ ...meta })),
    list: vi.fn(async () => [meta]),
    getIndex: vi.fn(async () => index),
    getStatus: vi.fn(() => ({ live: true, status: "idle" as const })),
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    answerApproval: vi.fn(async () => {}),
    ...overrides,
  }
  return {
    manager,
    index,
    append: (event: AgentStreamEvent) => { events.push({ ...event, idx: events.length } as AgentStreamEvent) },
  }
}

describe("octopus-agent api", () => {
  it("up probe returns ok", async () => {
    const handler = createAgentApi({ manager: makeStub().manager })
    const res = fakeRes()
    await handler(fakeReq("GET", `${BASE_PATH}/up`).req, res.res)
    expect(res.code()).toBe(200)
    expect(JSON.parse(res.text())).toEqual({ ok: true })
  })

  it("creates a session", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions`, { cwd: "/tmp/work", agentPreset: "standard", provider: "deepseek-official", model: "deepseek-v4-flash" }).req, res.res)
    expect(res.code()).toBe(201)
    expect(JSON.parse(res.text())).toMatchObject({ session: { id: "oct-AAAAAAA1", live: true } })
    expect(stub.manager.create).toHaveBeenCalledWith({ cwd: "/tmp/work", agentPreset: "standard", provider: "deepseek-official", model: "deepseek-v4-flash" })
  })

  it("rejects a relative cwd", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions`, { cwd: "relative/path" }).req, res.res)
    expect(res.code()).toBe(400)
    expect(JSON.parse(res.text())).toMatchObject({ error: "cwd must be an absolute path" })
    expect(stub.manager.create).not.toHaveBeenCalled()
  })

  it("rejects invalid json body", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions`, "{bad").req, res.res)
    expect(res.code()).toBe(400)
    expect(JSON.parse(res.text())).toMatchObject({ error: "malformed json body" })
  })

  it("lists sessions", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("GET", `${BASE_PATH}/sessions`).req, res.res)
    expect(res.code()).toBe(200)
    expect(JSON.parse(res.text())).toMatchObject({ items: [expect.objectContaining({ id: "oct-AAAAAAA1" })] })
  })

  it("streams history for a session", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("GET", `${BASE_PATH}/sessions/oct-AAAAAAA1/history`).req, res.res)
    expect(res.code()).toBe(200)
    const body = JSON.parse(res.text()) as { session: SessionMeta; events: AgentStreamEvent[]; lastIdx: number }
    expect(body.session).toMatchObject({ id: "oct-AAAAAAA1", live: true })
    expect(body.events).toHaveLength(2)
    expect(body.events[0]).toMatchObject({ idx: 0, type: "user-message", text: "hi" })
    expect(body.lastIdx).toBe(1)
    expect(stub.manager.getIndex).toHaveBeenCalledWith("oct-AAAAAAA1", { allowResume: true })
  })

  it("returns 404 for an unknown session history", async () => {
    const stub = makeStub({
      getIndex: vi.fn(async () => { throw new ManagerError("SESSION_NOT_FOUND", "session nope not found") }),
    })
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("GET", `${BASE_PATH}/sessions/nope/history`).req, res.res)
    expect(res.code()).toBe(404)
    expect(JSON.parse(res.text())).toMatchObject({ error: "session nope not found" })
  })

  it("returns status for a session", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("GET", `${BASE_PATH}/sessions/oct-AAAAAAA1/status`).req, res.res)
    expect(res.code()).toBe(200)
    expect(JSON.parse(res.text())).toMatchObject({ live: true, status: "idle" })
  })

  it("posts a message", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions/oct-AAAAAAA1/messages`, { text: "hello", answerQuestionId: "q1" }).req, res.res)
    expect(res.code()).toBe(200)
    expect(JSON.parse(res.text())).toEqual({ ok: true })
    expect(stub.manager.send).toHaveBeenCalledWith("oct-AAAAAAA1", "hello", "q1")
  })

  it("rejects a blank message", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions/oct-AAAAAAA1/messages`, { text: "   " }).req, res.res)
    expect(res.code()).toBe(400)
    expect(stub.manager.send).not.toHaveBeenCalled()
  })

  it("cancels a session", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions/oct-AAAAAAA1/cancel`).req, res.res)
    expect(res.code()).toBe(200)
    expect(JSON.parse(res.text())).toEqual({ ok: true })
    expect(stub.manager.cancel).toHaveBeenCalledWith("oct-AAAAAAA1")
  })

  it("disposes a session", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("DELETE", `${BASE_PATH}/sessions/oct-AAAAAAA1`).req, res.res)
    expect(res.code()).toBe(200)
    expect(JSON.parse(res.text())).toEqual({ ok: true })
    expect(stub.manager.dispose).toHaveBeenCalledWith("oct-AAAAAAA1")
  })

  it("answers an approval", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions/oct-AAAAAAA1/approvals/oct-AAAAAAA1:a0`, { decision: "deny" }).req, res.res)
    expect(res.code()).toBe(200)
    expect(JSON.parse(res.text())).toEqual({ ok: true })
    expect(stub.manager.answerApproval).toHaveBeenCalledWith("oct-AAAAAAA1", "oct-AAAAAAA1:a0", "deny")
  })

  it("rejects an invalid approval decision", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const res = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions/oct-AAAAAAA1/approvals/oct-AAAAAAA1:a0`, { decision: "maybe" }).req, res.res)
    expect(res.code()).toBe(400)
    expect(stub.manager.answerApproval).not.toHaveBeenCalled()
  })

  it("streams events via sse", async () => {
    const stub = makeStub()
    const handler = createAgentApi({ manager: stub.manager })
    const { req, emitClose } = fakeReq("GET", `${BASE_PATH}/sessions/oct-AAAAAAA1/events?after=1`)
    const res = fakeRes()
    vi.useFakeTimers()
    try {
      await handler(req, res.res)
      expect(res.code()).toBe(200)
      expect(stub.manager.getIndex).toHaveBeenCalledWith("oct-AAAAAAA1", { allowResume: true })
      expect(res.writes()).toHaveLength(1)
      expect(res.writes()[0]).toMatch(/^id: 1\ndata: /)
      expect(res.writes()[0]).toContain('"idx":1')
      expect(JSON.parse(res.writes()[0].split("\n")[1].slice("data: ".length))).toEqual({ idx: 1, type: "assistant-text", text: "yo" })
      stub.append({ idx: 2, type: "status", status: "running" })
      vi.advanceTimersByTime(250)
      expect(res.writes()).toHaveLength(2)
      expect(res.writes()[1]).toMatch(/^id: 2\ndata: /)
      expect(JSON.parse(res.writes()[1].split("\n")[1].slice("data: ".length))).toEqual({ idx: 2, type: "status", status: "running" })
      emitClose()
      vi.advanceTimersByTime(500)
      expect(res.writes()).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns 404 for an unknown route", async () => {
    const handler = createAgentApi({ manager: makeStub().manager })
    const res = fakeRes()
    await handler(fakeReq("GET", `${BASE_PATH}/sessions/oct-AAAAAAA1/unknown`).req, res.res)
    expect(res.code()).toBe(404)
    expect(JSON.parse(res.text())).toEqual({ error: "not found" })
  })
})
