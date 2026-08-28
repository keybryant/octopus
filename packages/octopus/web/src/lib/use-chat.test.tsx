import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentClient, AgentStreamEvent, SessionMeta } from "./types"
import { initialState, reduceEvent, useChat } from "./use-chat"

/** 与 agent-client.ts 相同的 Distributive Omit（直接 Omit 无法用于交集联合类型） */
type WithoutIdx<T> = T extends AgentStreamEvent ? Omit<T, "idx"> : never
type ScriptedEvent = WithoutIdx<AgentStreamEvent>

/** 可控 fake client：记录调用并手动 emit 事件流 */
function createFakeClient() {
  let idx = 0
  let handler: ((ev: AgentStreamEvent) => void) | null = null
  const sendSpy = vi.fn(async (text: string, answerQuestionId?: string) => undefined)
  const answerApprovalSpy = vi.fn(async (id: string, decision: "allow" | "deny") => undefined)
  const startSessionSpy = vi.fn(async () => "s-new")
  const switchToSpy = vi.fn(async () => undefined)
  const historySpy = vi.fn(async () => [] as AgentStreamEvent[])
  const listSessionsSpy = vi.fn(async () => [] as SessionMeta[])
  const client: AgentClient = {
    startSession: startSessionSpy,
    switchTo: switchToSpy,
    listSessions: listSessionsSpy,
    history: historySpy,
    subscribe: (h) => {
      handler = h
      return () => {
        handler = null
      }
    },
    send: sendSpy,
    cancel: vi.fn(async () => undefined),
    disposeSession: vi.fn(async () => undefined),
    answerApproval: answerApprovalSpy,
    reply: vi.fn(async () => ({ blocks: [] })),
  }
  const emit = (ev: ScriptedEvent): void => {
    const next: AgentStreamEvent = { ...ev, idx: ++idx } as AgentStreamEvent
    handler?.(next)
  }
  return {
    client,
    emit,
    sendSpy,
    answerApprovalSpy,
    startSessionSpy,
    switchToSpy,
    historySpy,
    listSessionsSpy,
  }
}

describe("useChat", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("client null → welcome only, send no-ops", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0))
    const { result } = renderHook(() => useChat(null))
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].role).toBe("assistant")
    expect(result.current.messages[0].text).toContain("早上好")
    expect(result.current.messages[0].text).toContain("当前上下文：Octopus Platform")
    act(() => {
      result.current.send("hello")
    })
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.status).toBe("idle")
  })

  it("boots empty sessions via startSession and send routes reducible user+assistant messages", async () => {
    const fake = createFakeClient()
    const { result } = renderHook(() => useChat(fake.client))
    await act(async () => undefined)
    expect(fake.startSessionSpy).toHaveBeenCalled()

    act(() => {
      result.current.send("hello")
    })
    expect(fake.sendSpy).toHaveBeenCalledWith("hello")

    act(() => {
      fake.emit({ type: "user-message", text: "hello" })
      fake.emit({ type: "turn", at: "start" })
      fake.emit({ type: "assistant-text", text: "hi" })
      fake.emit({ type: "assistant-text", text: "there,\n\nnext" })
      fake.emit({ type: "tool-call", callId: "c1", name: "todo_write", summary: "TASK-1 react" })
      fake.emit({ type: "turn", at: "end" })
    })
    await waitFor(() => expect(result.current.status).toBe("idle"))

    const userMsg = result.current.messages.find((m) => m.role === "user")
    expect(userMsg?.text).toBe("hello")
    const assistantMsgs = result.current.messages.filter((m) => m.role === "assistant")
    const aMsg = assistantMsgs.at(-1)!
    const paragraph = aMsg.blocks?.find((b) => b.kind === "paragraph")
    expect(paragraph).toBeDefined()
    if (paragraph?.kind === "paragraph") {
      expect(paragraph.segs).toEqual([{ text: "hi" }, { text: "there," }, { text: "next" }])
    }
    expect(aMsg.meta).toMatch(/^\d{2}:\d{2} · gpt-4 · \d+s$/)
    const noticeBlock = aMsg.blocks?.find((b) => b.kind === "notice")
    expect(noticeBlock).toMatchObject({ kind: "notice", title: "todo_write", hint: "TASK-1 react" })
    expect(result.current.artifacts).toEqual([
      { id: "c1", kind: "task", title: "TASK-1 react", subtitle: "Agent 任务清单", live: true },
    ])
  })

  it("approval event registers and decideApproval answers then clears", async () => {
    const fake = createFakeClient()
    const { result } = renderHook(() => useChat(fake.client))
    await act(async () => undefined)

    act(() => {
      fake.emit({ type: "approval", id: "a1", toolName: "bash", reason: "run ls" })
    })
    await waitFor(() => expect(result.current.approvals).toHaveLength(1))
    expect(result.current.approvals[0]).toMatchObject({
      kind: "approval",
      approvalId: "a1",
      toolName: "bash",
      reason: "run ls",
    })
    expect(result.current.messages.at(-1)?.blocks?.some((b) => b.kind === "approval")).toBe(true)

    act(() => {
      result.current.decideApproval("a1", "allow")
    })
    expect(fake.answerApprovalSpy).toHaveBeenCalledWith("a1", "allow")
    await waitFor(() => expect(result.current.approvals).toHaveLength(0))
  })

  it("question event sets pendingQuestion; answerQuestion sends with answerQuestionId", async () => {
    const fake = createFakeClient()
    const { result } = renderHook(() => useChat(fake.client))
    await act(async () => undefined)

    act(() => {
      fake.emit({ type: "question", id: "q1", question: "继续吗？", options: ["ok", "cancel"] })
    })
    await waitFor(() =>
      expect(result.current.pendingQuestion).toEqual({ id: "q1", question: "继续吗？", options: ["ok", "cancel"] }),
    )

    act(() => {
      result.current.answerQuestion("ok")
    })
    expect(fake.sendSpy).toHaveBeenCalledWith("ok", "q1")
    await waitFor(() => expect(result.current.pendingQuestion).toBeNull())

    act(() => {
      result.current.send("hi")
    })
    expect(fake.sendSpy).toHaveBeenCalledWith("hi")
  })

  it("derives artifacts from tool-call names and dedupes by callId", async () => {
    const fake = createFakeClient()
    const { result } = renderHook(() => useChat(fake.client))
    await act(async () => undefined)

    act(() => {
      fake.emit({ type: "tool-call", callId: "t1", name: "todo_write", summary: "TASK-2850 · React 19 升级兼容性验证" })
      fake.emit({ type: "tool-call", callId: "t2", name: "str_replace_editor", summary: "TASK-2850 升级依赖" })
      fake.emit({ type: "tool-call", callId: "t1", name: "todo_write", summary: "dup" })
      fake.emit({ type: "tool-call", callId: "t3", name: "read_file", summary: "ignored" })
    })
    await waitFor(() => expect(result.current.artifacts).toHaveLength(2))
    expect(result.current.artifacts).toEqual([
      { id: "t1", kind: "task", title: "TASK-2850 · React 19 升级兼", subtitle: "Agent 任务清单", live: true },
      { id: "t2", kind: "doc", title: "TASK-2850 升级依赖", subtitle: "Agent 产出", live: false },
    ])
  })

  it("thinking toggles with turn start/end; send no-ops while thinking; error appends notice", async () => {
    const fake = createFakeClient()
    const { result } = renderHook(() => useChat(fake.client))
    await act(async () => undefined)

    act(() => {
      fake.emit({ type: "turn", at: "start" })
    })
    expect(result.current.status).toBe("thinking")
    expect(result.current.thinking).toBe(true)

    act(() => {
      fake.emit({ type: "assistant-text", text: "hi" })
      fake.emit({ type: "error", message: "boom" })
    })
    const inTurn = result.current.messages.at(-1)
    expect(
      inTurn?.blocks?.some((b) => b.kind === "notice" && b.title === "错误" && b.hint === "boom"),
    ).toBe(true)

    act(() => {
      result.current.send("x")
    })
    expect(fake.sendSpy).not.toHaveBeenCalled()

    act(() => {
      fake.emit({ type: "turn", at: "end" })
    })
    expect(result.current.status).toBe("idle")
    expect(result.current.thinking).toBe(false)

    act(() => {
      fake.emit({ type: "error", message: "boom2" })
    })
    const standalone = result.current.messages.at(-1)
    expect(standalone?.role).toBe("assistant")
    expect(
      standalone?.blocks?.some((b) => b.kind === "notice" && b.title === "错误" && b.hint === "boom2"),
    ).toBe(true)
  })

  it("resumes most recent session replaying history through the shared reducer", async () => {
    const fake = createFakeClient()
    const meta: SessionMeta = { id: "s1", createdAt: "2026-08-28T09:00:00.000Z", cwd: null, title: "t", live: true }
    fake.listSessionsSpy.mockResolvedValue([meta])
    fake.historySpy.mockResolvedValue([
      { idx: 1, type: "user-message", text: "旧消息" },
      { idx: 2, type: "turn", at: "start" },
      { idx: 3, type: "assistant-text", text: "旧回复" },
      { idx: 4, type: "turn", at: "end" },
    ])
    const { result } = renderHook(() => useChat(fake.client))
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("s1"))
    await waitFor(() => expect(result.current.messages).toHaveLength(3))
    expect(result.current.messages[0].text).toContain("当前上下文")
    expect(result.current.messages[1]).toMatchObject({ role: "user", text: "旧消息" })
    expect(result.current.messages[2]).toMatchObject({ role: "assistant" })
  })

  it("switchSession reloads welcome plus replayed history", async () => {
    const fake = createFakeClient()
    fake.listSessionsSpy.mockResolvedValue([
      { id: "s1", createdAt: "2026-08-28T09:00:00.000Z", cwd: null, title: "t", live: true },
    ])
    fake.historySpy.mockResolvedValue([
      { idx: 1, type: "user-message", text: "again" },
      { idx: 2, type: "turn", at: "start" },
      { idx: 3, type: "assistant-text", text: "回放" },
      { idx: 4, type: "turn", at: "end" },
    ])
    const { result } = renderHook(() => useChat(fake.client))
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("s1"))

    act(() => {
      void result.current.switchSession("s1")
    })
    await waitFor(() =>
      expect(result.current.messages.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]),
    )
    expect(result.current.messages[1]).toMatchObject({ role: "user", text: "again" })
  })
})

describe("reduceEvent", () => {
  it("toggles status, flushes paragraphs with meta and keeps thinking while turn open", () => {
    let s = initialState()
    s = reduceEvent(s, { idx: 1, type: "turn", at: "start" })
    expect(s.status).toBe("thinking")
    s = reduceEvent(s, { idx: 2, type: "assistant-text", text: "a\n\nb" })
    s = reduceEvent(s, { idx: 3, type: "status", status: "idle" })
    expect(s.status).toBe("thinking")
    s = reduceEvent(s, { idx: 4, type: "turn", at: "end" })
    expect(s.status).toBe("idle")
    const last = s.messages.at(-1)!
    expect(last.role).toBe("assistant")
    expect(last.meta).toMatch(/^\d{2}:\d{2} · gpt-4 · \d+s$/)
    const paragraph = last.blocks?.find((b) => b.kind === "paragraph")
    expect(paragraph).toMatchObject({ kind: "paragraph", segs: [{ text: "a" }, { text: "b" }] })
  })
})
