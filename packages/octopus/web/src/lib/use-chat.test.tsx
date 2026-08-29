import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentClient, AgentStreamEvent, SessionMeta } from "./types"
import {
  createProjectSessionStore,
  isTaskSession,
  projectSessions,
  resolvePmSession,
  useChat,
  initialState,
  reduceEvent,
} from "./use-chat"

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
    listPresets: vi.fn(async () => [{ id: "standard", name: "标准模式" }]),
    getSessionContext: vi.fn(async () => ({ live: true as const })),
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

  it("tool-result ok:true adds no extra block; ok:false adds danger notice", async () => {
    const fake = createFakeClient()
    const { result } = renderHook(() => useChat(fake.client))
    await act(async () => undefined)

    act(() => {
      fake.emit({ type: "turn", at: "start" })
      fake.emit({ type: "assistant-text", text: "run" })
      fake.emit({ type: "tool-call", callId: "d1", name: "bash", summary: "npm test" })
      fake.emit({ type: "tool-result", callId: "d1", name: "bash", ok: true, preview: "all green" })
      fake.emit({ type: "turn", at: "end" })
    })
    const msg = result.current.messages.at(-1)!
    const notices = msg.blocks!.filter((b) => b.kind === "notice")
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: "notice", title: "bash", hint: "npm test" })
    expect(notices[0].tone).toBeUndefined()

    act(() => {
      fake.emit({ type: "turn", at: "start" })
      fake.emit({ type: "assistant-text", text: "write" })
      fake.emit({ type: "tool-call", callId: "d2", name: "write_file", summary: "report.md" })
      fake.emit({ type: "tool-result", callId: "d2", name: "write_file", ok: false, preview: "permission denied" })
      fake.emit({ type: "turn", at: "end" })
    })
    const dangerMsg = result.current.messages.at(-1)!
    const dangerNotice = dangerMsg.blocks!.find((b) => b.kind === "notice" && b.tone === "danger")
    expect(dangerNotice).toMatchObject({ kind: "notice", title: "write_file", hint: "permission denied", tone: "danger" })
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

describe("project session helpers", () => {
  const pm = (id: string, cwd: string | null, createdAt = "2026-08-28T10:00:00.000Z"): SessionMeta => ({
    id, cwd, title: null, live: false, createdAt,
  })

  it("isTaskSession 识别 task- 前缀", () => {
    expect(isTaskSession({ id: "task-AAAA1111" })).toBe(true)
    expect(isTaskSession({ id: "oct-AAAA1111" })).toBe(false)
  })

  it("projectSessions 按 cwd 过滤并按 createdAt 倒序", () => {
    const list = [pm("s1", "/ws/a"), pm("task-x1", "/ws/a", "2026-08-28T11:00:00.000Z"), pm("s2", "/ws/b")]
    const result = projectSessions(list, "/ws/a")
    expect(result.map((s) => s.id)).toEqual(["task-x1", "s1"])
  })

  it("resolvePmSession：映射命中优先", () => {
    const list = [pm("s1", "/ws/a", "2026-08-28T09:00:00.000Z"), pm("s2", "/ws/a", "2026-08-28T11:00:00.000Z")]
    expect(resolvePmSession(list, "/ws/a", "s1")?.id).toBe("s1")
  })

  it("resolvePmSession：映射失效回落 cwd 匹配的最新非 task 会话", () => {
    const list = [
      pm("s1", "/ws/a", "2026-08-28T09:00:00.000Z"),
      pm("task-x1", "/ws/a", "2026-08-28T10:00:00.000Z"),
      pm("s2", "/ws/a", "2026-08-28T11:00:00.000Z"),
      pm("s-other", "/ws/b", "2026-08-28T12:00:00.000Z"),
    ]
    expect(resolvePmSession(list, "/ws/a", "pm-dead")?.id).toBe("s2")
    expect(resolvePmSession(list, "/ws/a", null)?.id).toBe("s2")
  })

  it("resolvePmSession：无匹配返回 null（调用方新建）", () => {
    expect(resolvePmSession([pm("s-other", "/ws/b")], "/ws/a", null)).toBeNull()
  })

  it("createProjectSessionStore 读写与损坏容错", () => {
    const mem: Record<string, string> = {}
    const storage: Pick<Storage, "getItem" | "setItem"> = {
      getItem: (k) => mem[k] ?? null,
      setItem: (k, v) => { mem[k] = v },
    }
    const store = createProjectSessionStore(storage)
    expect(store.get("prjA")).toBeNull()
    store.set("prjA", "s1")
    expect(store.get("prjA")).toBe("s1")
    const reopened = createProjectSessionStore(storage)
    expect(reopened.get("prjA")).toBe("s1")
    const broken = createProjectSessionStore({
      getItem: () => "{not json",
      setItem: () => undefined,
    })
    expect(broken.get("prjA")).toBeNull()
    const none = createProjectSessionStore(null)
    none.set("prjA", "s1")
    expect(none.get("prjA")).toBe("s1")
  })
})

describe("useChat project binding", () => {
  function storageHarness() {
    const mem: Record<string, string> = {}
    const storage: Pick<Storage, "getItem" | "setItem"> = {
      getItem: (k) => mem[k] ?? null,
      setItem: (k, v) => { mem[k] = v },
    }
    const raw = (): Record<string, string> => JSON.parse(mem["octopus.projectSessions"] ?? "{}")
    return { storage, raw }
  }

  it("bootstrap 绑定当前项目：cwd 匹配的 PM 会话 + 历史重放 + 映射落盘", async () => {
    const fake = createFakeClient()
    const { storage, raw } = storageHarness()
    fake.listSessionsSpy.mockResolvedValue([
      { id: "pm-1", createdAt: "2026-08-28T10:00:00.000Z", cwd: "/ws/a", title: null, live: true },
      { id: "task-x1", createdAt: "2026-08-28T11:00:00.000Z", cwd: "/ws/a", title: null, live: true },
      { id: "s-other", createdAt: "2026-08-28T12:00:00.000Z", cwd: "/ws/b", title: null, live: true },
    ])
    fake.historySpy.mockResolvedValue([
      { idx: 1, type: "user-message", text: "PM 历史" },
      { idx: 2, type: "turn", at: "start" },
      { idx: 3, type: "assistant-text", text: "PM 回复" },
      { idx: 4, type: "turn", at: "end" },
    ])
    const { result } = renderHook(() =>
      useChat(fake.client, { projectId: "prjA", workspacePath: "/ws/a", storage }),
    )
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("pm-1"))
    await waitFor(() => expect(result.current.messages).toHaveLength(3))
    expect(result.current.messages[1]).toMatchObject({ role: "user", text: "PM 历史" })
    expect(raw()).toEqual({ prjA: "pm-1" })
    expect(fake.startSessionSpy).not.toHaveBeenCalled()
  })

  it("bootstrap 无 PM 会话时自动创建（cwd=workspacePath）并写映射", async () => {
    const fake = createFakeClient()
    const { storage, raw } = storageHarness()
    fake.listSessionsSpy.mockResolvedValue([{ id: "s-other", createdAt: "2026-08-28T10:00:00.000Z", cwd: "/ws/b", title: null, live: true }])
    fake.startSessionSpy.mockResolvedValue("pm-new")
    const { result } = renderHook(() =>
      useChat(fake.client, { projectId: "prjA", workspacePath: "/ws/a", storage }),
    )
    await waitFor(() => expect(fake.startSessionSpy).toHaveBeenCalledWith({ cwd: "/ws/a" }))
    expect(raw()).toEqual({ prjA: "pm-new" })
    expect(result.current.messages).toHaveLength(1)
  })

  it("switchProject 按映射命中切换并重放", async () => {
    const fake = createFakeClient()
    const { storage, raw } = storageHarness()
    fake.listSessionsSpy.mockResolvedValue([{ id: "pm-b", createdAt: "2026-08-28T10:00:00.000Z", cwd: "/ws/b", title: null, live: true }])
    fake.historySpy.mockResolvedValue([{ idx: 1, type: "user-message", text: "B 项目" }])
    const { result } = renderHook(() =>
      useChat(fake.client, { projectId: "prjA", workspacePath: "/ws/a", storage }),
    )
    await waitFor(() => expect(fake.startSessionSpy).toHaveBeenCalled())
    await act(async () => {
      await result.current.switchProject("prjB", "/ws/b")
    })
    expect(fake.switchToSpy).toHaveBeenCalledWith("pm-b")
    expect(raw()).toEqual({ prjA: expect.any(String), prjB: "pm-b" })
    expect(result.current.messages[1]).toMatchObject({ role: "user", text: "B 项目" })
  })

  it("switchProject 映射失效回落 cwd 匹配并覆盖映射", async () => {
    const fake = createFakeClient()
    const { storage, raw } = storageHarness()
    storage.setItem("octopus.projectSessions", JSON.stringify({ prjB: "pm-dead" }))
    fake.listSessionsSpy.mockResolvedValue([
      { id: "pm-1", createdAt: "2026-08-28T09:00:00.000Z", cwd: "/ws/a", title: null, live: true },
      { id: "pm-b", createdAt: "2026-08-28T11:00:00.000Z", cwd: "/ws/b", title: null, live: true },
    ])
    const { result } = renderHook(() =>
      useChat(fake.client, { projectId: "prjA", workspacePath: "/ws/a", storage }),
    )
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("pm-1"))
    await act(async () => {
      await result.current.switchProject("prjB", "/ws/b")
    })
    expect(fake.switchToSpy).toHaveBeenCalledWith("pm-b")
    expect(raw()).toEqual({ prjA: "pm-1", prjB: "pm-b" })
  })

  it("switchProject 无匹配时自动创建并写映射", async () => {
    const fake = createFakeClient()
    const { storage, raw } = storageHarness()
    fake.listSessionsSpy.mockResolvedValue([])
    fake.startSessionSpy.mockResolvedValue("pm-new-b")
    const { result } = renderHook(() =>
      useChat(fake.client, { projectId: "prjA", workspacePath: "/ws/a", storage }),
    )
    await waitFor(() => expect(fake.startSessionSpy).toHaveBeenCalled())
    await act(async () => {
      await result.current.switchProject("prjB", "/ws/b", { agentPreset: "minimal" })
    })
    expect(fake.startSessionSpy).toHaveBeenCalledWith({ cwd: "/ws/b", agentPreset: "minimal" })
    expect(raw()).toEqual({ prjA: expect.any(String), prjB: "pm-new-b" })
  })

  it("switchSession 切到任务会话不覆盖映射，切到 PM 会话覆盖", async () => {
    const fake = createFakeClient()
    const { storage, raw } = storageHarness()
    fake.listSessionsSpy.mockResolvedValue([
      { id: "pm-1", createdAt: "2026-08-28T10:00:00.000Z", cwd: "/ws/a", title: null, live: true },
      { id: "task-x1", createdAt: "2026-08-28T11:00:00.000Z", cwd: "/ws/a", title: null, live: true },
      { id: "pm-2", createdAt: "2026-08-28T12:00:00.000Z", cwd: "/ws/a", title: null, live: true },
    ])
    const { result } = renderHook(() =>
      useChat(fake.client, { projectId: "prjA", workspacePath: "/ws/a", storage }),
    )
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("pm-2"))

    await act(async () => {
      await result.current.switchSession("task-x1")
    })
    expect(raw().prjA).toBe("pm-2")

    await act(async () => {
      await result.current.switchSession("pm-1")
    })
    expect(raw().prjA).toBe("pm-1")
  })
})
