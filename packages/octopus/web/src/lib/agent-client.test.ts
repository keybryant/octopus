import { afterEach, describe, expect, it, vi } from "vitest"
import { createDefaultAgentClient, createHttpAgentClient, createMockAgentClient } from "./agent-client"
import type { AgentStreamEvent } from "./types"

function plain(data: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => data }
}

function streamText(events: Array<{ idx: number; payload: unknown }>): { ok: boolean; status: number; text: () => Promise<string> } {
  const frames = events.map((e) => `id: ${e.idx}\ndata: ${JSON.stringify({ idx: e.idx, ...(e.payload as object) })}\n\n`).join("")
  return { ok: true, status: 200, text: async () => frames }
}

const SESSION_S1 = { id: "s1", createdAt: "t", cwd: null, title: "t", live: true }

describe("createMockAgentClient", () => {
  it("returns mock session meta and id", async () => {
    const client = createMockAgentClient(0)
    expect(await client.startSession()).toBe("mock")
    const sessions = await client.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe("mock")
    expect(sessions[0].title).toBe("Mock 会话")
    expect(sessions[0].live).toBe(true)
  })

  it("streams scripted priority events with monotonic idx", async () => {
    const client = createMockAgentClient(0)
    const received: AgentStreamEvent[] = []
    client.subscribe((ev) => received.push(ev))
    await client.send("先列一下优先事项")

    expect(received.map((ev) => ev.type)).toEqual([
      "user-message",
      "turn",
      "assistant-text",
      "tool-call",
      "tool-call",
      "tool-call",
      "turn",
      "status",
    ])
    expect(received[0]).toMatchObject({ type: "user-message", text: "先列一下优先事项" })
    expect(received[1]).toMatchObject({ type: "turn", at: "start" })
    const tools = received.filter((ev) => ev.type === "tool-call")
    expect(tools.map((ev) => ev.callId)).toEqual(["mock-t1", "mock-t2", "mock-t3"])
    expect(tools.every((ev) => ev.name === "todo_write")).toBe(true)
    expect(received.at(-2)).toMatchObject({ type: "turn", at: "end" })
    expect(received.at(-1)).toMatchObject({ type: "status", status: "idle" })
    expect(received.map((ev) => ev.idx)).toEqual(received.map((ev) => ev.idx).sort((a, b) => a - b))
    expect(new Set(received.map((ev) => ev.idx)).size).toBe(received.length)
  })

  it("streams delegation events with str_replace_editor tool call", async () => {
    const client = createMockAgentClient(0)
    const received: AgentStreamEvent[] = []
    client.subscribe((ev) => received.push(ev))
    await client.send("把 TASK-2850 交给 Agent 自动跑")

    const tools = received.filter((ev) => ev.type === "tool-call")
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ callId: "mock-t4", name: "str_replace_editor" })
    expect(received.some((ev) => ev.type === "assistant-text")).toBe(true)
  })

  it("streams ack text without tool calls for unmatched input", async () => {
    const client = createMockAgentClient(0)
    const received: AgentStreamEvent[] = []
    client.subscribe((ev) => received.push(ev))
    await client.send("随便说点什么")

    expect(received.some((ev) => ev.type === "assistant-text")).toBe(true)
    expect(received.some((ev) => ev.type === "tool-call")).toBe(false)
  })

  it("no-ops cancel, disposeSession and answerApproval", async () => {
    const client = createMockAgentClient(0)
    await expect(client.cancel()).resolves.toBeUndefined()
    await expect(client.disposeSession()).resolves.toBeUndefined()
    await expect(client.answerApproval("a1", "allow")).resolves.toBeUndefined()
  })
})

describe("createHttpAgentClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts session creation and returns the session id", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/octopus-agent/sessions" && init?.method === "POST") return plain({ session: SESSION_S1 }) as never
      return plain({}) as never
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createHttpAgentClient()
    expect(await client.startSession({ cwd: "/tmp/a" })).toBe("s1")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/octopus-agent/sessions",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toEqual({ cwd: "/tmp/a" })
  })

  it("loads session list and history", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/octopus-agent/sessions") return plain({ items: [SESSION_S1] }) as never
      if (url.endsWith("/history")) {
        return plain({ session: SESSION_S1, events: [{ idx: 2, type: "user-message", text: "hi" }], lastIdx: 2 }) as never
      }
      return plain({}) as never
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createHttpAgentClient()
    expect(await client.listSessions()).toEqual([SESSION_S1])
    const events = await client.history("s1")
    expect(events).toEqual([{ idx: 2, type: "user-message", text: "hi" }])
  })

  it("polls events after lastIdx and skips already delivered ones", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/octopus-agent/sessions" ) return plain({ session: SESSION_S1 }) as never
      if (url.includes("/history")) return plain({ session: SESSION_S1, events: [{ idx: 0, type: "user-message", text: "hi" }] }) as never
      if (url.includes("/events")) {
        return streamText([
          { idx: 0, payload: { type: "user-message", text: "old" } },
          { idx: 1, payload: { type: "assistant-text", text: "new" } },
        ]) as never
      }
      return plain({}) as never
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createHttpAgentClient()
    await client.startSession()
    await client.history("s1")
    const received: AgentStreamEvent[] = []
    const unsub = client.subscribe((ev) => received.push(ev))
    await vi.waitFor(() => {
      expect(received.some((ev) => ev.type === "assistant-text")).toBe(true)
    })
    expect(received.some((ev) => ev.type === "user-message")).toBe(false)
    expect(received[0]).toMatchObject({ idx: 1, type: "assistant-text", text: "new" })
    unsub()
  })

  it("uses EventSource when available and closes on unsubscribe", async () => {
    const fetchMock = vi.fn(async () => plain({ session: SESSION_S1 }) as never)
    vi.stubGlobal("fetch", fetchMock)
    class FakeEventSource {
      static instances: FakeEventSource[] = []
      url: string
      onmessage: ((ev: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      closed = false
      constructor(url: string) {
        this.url = url
        FakeEventSource.instances.push(this)
      }
      close(): void {
        this.closed = true
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource)
    const client = createHttpAgentClient()
    await client.startSession()
    const received: AgentStreamEvent[] = []
    const unsub = client.subscribe((ev) => received.push(ev))

    const es = FakeEventSource.instances[0]
    expect(es.url).toBe("/api/octopus-agent/sessions/s1/events?after=0")
    es.onmessage?.({ data: JSON.stringify({ idx: 0, type: "user-message", text: "old" }) })
    es.onmessage?.({ data: JSON.stringify({ idx: 0, type: "user-message", text: "dup" }) })
    es.onmessage?.({ data: JSON.stringify({ idx: 1, type: "assistant-text", text: "new" }) })
    expect(received.map((ev) => ev.type)).toEqual(["user-message", "assistant-text"])
    expect(received[1]).toMatchObject({ idx: 1, type: "assistant-text", text: "new" })

    unsub()
    expect(es.closed).toBe(true)
  })

  it("sends messages, cancels and approves via the right routes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/octopus-agent/sessions" && init?.method === "POST") return plain({ session: SESSION_S1 }) as never
      return plain({}) as never
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createHttpAgentClient()
    await client.startSession()
    await client.send("hi")
    await client.cancel()
    await client.answerApproval("a1", "deny")
    const called = fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), method: String(init?.method) }))
    expect(called).toContainEqual({ url: "/api/octopus-agent/sessions/s1/messages", method: "POST" })
    expect(called).toContainEqual({ url: "/api/octopus-agent/sessions/s1/cancel", method: "POST" })
    expect(called).toContainEqual({ url: "/api/octopus-agent/sessions/s1/approvals/a1", method: "POST" })
  })
})

describe("createDefaultAgentClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("probes /up and picks http client when ok", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/octopus-agent/up") return { ok: true, status: 200, json: async () => ({ ok: true }) } as never
      if (url === "/api/octopus-agent/sessions") return plain({ session: SESSION_S1 }) as never
      return plain({}) as never
    })
    vi.stubGlobal("fetch", fetchImpl)
    const client = await createDefaultAgentClient(fetchImpl as unknown as typeof fetch)
    expect(await client.startSession()).toBe("s1")
  })

  it("picks mock when /up returns non-ok", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as never)
    const client = await createDefaultAgentClient(fetchImpl as unknown as typeof fetch)
    expect(await client.startSession()).toBe("mock")
  })

  it("picks mock when body ok flag is missing", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ msg: "no ok flag" }) }) as never)
    const client = await createDefaultAgentClient(fetchImpl as unknown as typeof fetch)
    expect(await client.startSession()).toBe("mock")
  })

  it("picks mock when probe fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to parse URL from /api/octopus-agent/up")
    })
    const client = await createDefaultAgentClient(fetchImpl as unknown as typeof fetch)
    expect(await client.startSession()).toBe("mock")
  })
})
