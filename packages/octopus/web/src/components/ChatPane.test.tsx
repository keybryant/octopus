import { act, render, screen, waitFor } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { AgentClient, AgentStreamEvent, Artifact, SessionMeta } from "../lib/types"
import { ChatPane } from "./ChatPane"

/** 与 agent-client.ts 相同的 Distributive Omit（直接 Omit 无法用于交集联合类型） */
type WithoutIdx<T> = T extends AgentStreamEvent ? Omit<T, "idx"> : never
type ScriptedEvent = WithoutIdx<AgentStreamEvent>

function createFakeClient(events?: ScriptedEvent[]) {
  let idx = 0
  let handler: ((ev: AgentStreamEvent) => void) | null = null
  const sessions: SessionMeta[] = []
  const sendSpy = vi.fn(async (text: string, answerQuestionId?: string) => {
    const script = events ?? [
      { type: "user-message", text },
      { type: "turn", at: "start" },
      { type: "assistant-text", text: "收到" },
      { type: "turn", at: "end" },
      { type: "status", status: "idle" },
    ]
    for (const ev of script) emit(ev)
  })
  const answerApprovalSpy = vi.fn(async (id: string, decision: "allow" | "deny") => undefined)
  const startSessionSpy = vi.fn(async () => "s-new")
  const switchToSpy = vi.fn(async () => undefined)
  const historySpy = vi.fn(async () => [] as AgentStreamEvent[])
  const listSessionsSpy = vi.fn(async () => [...sessions])
  const listPresetsSpy = vi.fn(async () => [
    { id: "standard", name: "标准模式" },
    { id: "minimal", name: "最小模式" },
  ])
  const getSessionContextSpy = vi.fn(async () => ({
    live: true as const,
    provider: "deepseek-official",
    model: "deepseek-v4-flash",
    maxTokens: 8192,
    prompt: "system prompt",
    context: "runtime context",
  }))
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
    listPresets: listPresetsSpy,
    getSessionContext: getSessionContextSpy,
  }
  const emit = (ev: ScriptedEvent): void => {
    const next: AgentStreamEvent = { ...ev, idx: ++idx } as AgentStreamEvent
    handler?.(next)
  }
  return {
    client,
    emit,
    sessions,
    sendSpy,
    answerApprovalSpy,
    startSessionSpy,
    switchToSpy,
    historySpy,
    listSessionsSpy,
    listPresetsSpy,
    getSessionContextSpy,
  }
}

describe("ChatPane", () => {
  it("full flow: welcome → type & send → assistant reply appears", async () => {
    render(<ChatPane agentClient={createFakeClient().client} />)
    expect(await screen.findByText(/当前上下文/)).toBeInTheDocument()

    const box = screen.getByPlaceholderText(/给 Octo Agent 下指令/)
    fireEvent.input(box, { target: { value: "列出优先事项" } })
    fireEvent.keyDown(box, { key: "Enter" })

    await waitFor(() => expect(screen.getAllByText("收到").length).toBeGreaterThan(0))
    // thinking 占位消失
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument())
  })

  it("reports artifacts upward when replies produce them", async () => {
    const onArtifactsChange = vi.fn()
    render(
      <ChatPane
        agentClient={createFakeClient([
          { type: "user-message", text: "跑起来" },
          { type: "turn", at: "start" },
          { type: "assistant-text", text: "收到" },
          { type: "tool-call", callId: "art-x", name: "str_replace_editor", summary: "TASK-9000 新产出" },
          { type: "turn", at: "end" },
          { type: "status", status: "idle" },
        ]).client}
        onArtifactsChange={onArtifactsChange}
      />,
    )

    const box = screen.getByPlaceholderText(/给 Octo Agent 下指令/)
    fireEvent.input(box, { target: { value: "跑起来" } })
    fireEvent.keyDown(box, { key: "Enter" })

    await waitFor(() => {
      const last: Artifact[] = onArtifactsChange.mock.lastCall?.[0] ?? []
      expect(last.some((a) => a.id === "art-x")).toBe(true)
    })
  })

  it("session switcher lists sessions; clicking a row switches and resets chat", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    fake.sessions.push(
      { id: "s-1", createdAt: "2026-08-28T10:00:00.000Z", cwd: "C:/work", title: "冲刺周计划", live: true },
      { id: "s-2", createdAt: "2026-08-27T09:00:00.000Z", cwd: "C:/work", title: null, live: false },
    )
    render(<ChatPane agentClient={fake.client} />)
    await waitFor(() => expect(screen.getByText(/当前上下文/)).toBeInTheDocument())
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("s-1"))

    act(() => fake.emit({ type: "user-message", text: "手工消息" }))
    expect(await screen.findByText("手工消息")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /会话/ }))
    expect(await screen.findByText("冲刺周计划")).toBeInTheDocument()
    expect(screen.getByText("s-2")).toBeInTheDocument()
    expect(screen.getByTestId("session-live-s-1")).toBeInTheDocument()

    await user.click(screen.getByText("s-2"))
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("s-2"))
    await waitFor(() => expect(screen.queryByText("手工消息")).not.toBeInTheDocument())
    expect(await screen.findByText(/当前上下文/)).toBeInTheDocument()
    expect(screen.queryByText("冲刺周计划")).not.toBeInTheDocument()
  })

  it("new session calls startSession with cwd, resets chat and marks current", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    render(<ChatPane agentClient={fake.client} currentCwd="C:/repo" />)
    await waitFor(() => expect(screen.getByText(/当前上下文/)).toBeInTheDocument())

    act(() => fake.emit({ type: "user-message", text: "旧消息" }))
    expect(await screen.findByText("旧消息")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /会话/ }))
    await user.click(await screen.findByText("新建会话"))
    await waitFor(() =>
      expect(fake.startSessionSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: "C:/repo" })),
    )
    await waitFor(() => expect(screen.queryByText("旧消息")).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/当前上下文/)).toBeInTheDocument())
    expect(screen.queryByText("新建会话")).not.toBeInTheDocument()

    fake.sessions.push({
      id: "s-new",
      createdAt: "2026-08-28T11:00:00.000Z",
      cwd: "C:/repo",
      title: "新会话",
      live: false,
    })
    await user.click(screen.getByRole("button", { name: /会话/ }))
    expect(await screen.findByTestId("session-current-s-new")).toBeInTheDocument()
  })

  it("approval block renders; clicking allow calls answerApproval and disables buttons", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    render(<ChatPane agentClient={fake.client} />)
    expect(await screen.findByText(/当前上下文/)).toBeInTheDocument()

    act(() => fake.emit({ type: "approval", id: "a1", toolName: "bash", reason: "rm -rf node_modules" }))
    const box = await screen.findByTestId("approval-a1")
    expect(box).toHaveTextContent("bash")

    const allowBtn = screen.getByRole("button", { name: "允许" })
    const denyBtn = screen.getByRole("button", { name: "拒绝" })
    await user.click(allowBtn)
    expect(fake.answerApprovalSpy).toHaveBeenCalledWith("a1", "allow")
    await waitFor(() => expect(allowBtn).toBeDisabled())
    await waitFor(() => expect(denyBtn).toBeDisabled())
  })

  it("shows pending question banner and sending input answers it", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    render(<ChatPane agentClient={fake.client} />)
    expect(await screen.findByText(/当前上下文/)).toBeInTheDocument()

    act(() => fake.emit({ type: "question", id: "q1", question: "选择哪个分支？" }))
    const banner = await screen.findByTitle("pending-question")
    expect(banner).toHaveTextContent("Agent 提问：选择哪个分支？")

    const box = screen.getByPlaceholderText(/给 Octo Agent 下指令/)
    await user.type(box, "main")
    await user.keyboard("{Enter}")
    await waitFor(() => expect(fake.sendSpy).toHaveBeenCalledWith("main", "q1"))
    await waitFor(() => expect(screen.queryByTitle("pending-question")).not.toBeInTheDocument())
  })

  it("context viewer opens sheet with system prompt and runtime context", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    fake.sessions.push({ id: "s-1", createdAt: "2026-08-28T10:00:00.000Z", cwd: "C:/work", title: "冲刺周计划", live: true })
    render(<ChatPane agentClient={fake.client} />)

    await waitFor(() => expect(screen.getByTestId("session-switcher")).toBeEnabled())
    await user.click(screen.getByTestId("session-switcher"))
    await screen.findByText("冲刺周计划")
    await user.keyboard("{Escape}")
    const btn = screen.getByTestId("context-viewer")
    await user.click(btn)
    await waitFor(() => expect(fake.getSessionContextSpy).toHaveBeenCalledWith("s-1"))
    expect(await screen.findByTestId("context-prompt")).toHaveTextContent("system prompt")
    expect(screen.getByTestId("context-runtime")).toHaveTextContent("runtime context")
    expect(screen.getByText(/deepseek-official/)).toBeInTheDocument()
  })

  it("preset switcher lists presets and new session forwards the selection", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    render(<ChatPane agentClient={fake.client} currentCwd="/ws" />)
    const trigger = await screen.findByTestId("preset-switcher")
    await waitFor(() => expect(fake.listPresetsSpy).toHaveBeenCalled())

    await user.click(trigger)
    await user.click(await screen.findByTestId("preset-option-minimal"))
    await waitFor(() => expect(trigger).toHaveTextContent("预设：最小模式"))

    await user.click(screen.getByTestId("session-switcher"))
    await user.click(await screen.findByTestId("session-new"))
    await waitFor(() => expect(fake.startSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/ws", agentPreset: "minimal" }),
    ))
  })
})
