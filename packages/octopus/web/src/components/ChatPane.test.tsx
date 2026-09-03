import { act, render, screen, waitFor } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
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
  const cancelSpy = vi.fn(async () => undefined)
  const answerApprovalSpy = vi.fn(async (id: string, decision: "allow" | "deny") => undefined)
  const startSessionSpy = vi.fn(async () => "s-new")
  const switchToSpy = vi.fn(async () => undefined)
  const historySpy = vi.fn(async () => [] as AgentStreamEvent[])
  const listSessionsSpy = vi.fn(async () => [...sessions])
  const listPresetsSpy = vi.fn(async () => [
    { id: "octopus-developer", name: "开发工程师", description: "专注编码实现：读写代码、运行测试" },
    { id: "octopus-designer", name: "设计工程师", description: "专注设计与评审：需求澄清、方案设计" },
  ])
  const savePresetModelSpy = vi.fn(async () => undefined)
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
    cancel: cancelSpy,
    disposeSession: vi.fn(async () => undefined),
    answerApproval: answerApprovalSpy,
    reply: vi.fn(async () => ({ blocks: [] })),
    listPresets: listPresetsSpy,
    savePresetModel: savePresetModelSpy,
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
    cancelSpy,
    answerApprovalSpy,
    startSessionSpy,
    switchToSpy,
    historySpy,
    listSessionsSpy,
    listPresetsSpy,
    getSessionContextSpy,
    savePresetModelSpy,
  }
}

describe("ChatPane", () => {
  afterEach(() => {
    localStorage.clear()
  })

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

  it("切换会话时预设选择器同步为目标会话的 agentPreset", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    fake.sessions.push(
      { id: "s-pm", createdAt: "2026-08-28T10:00:00.000Z", cwd: "C:/work", title: "PM 会话", live: true, agentPreset: "octopus-designer" },
      { id: "s-dev", createdAt: "2026-08-28T11:00:00.000Z", cwd: "C:/work", title: "开发会话", live: true, agentPreset: "octopus-developer" },
    )
    render(<ChatPane agentClient={fake.client} />)
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("s-dev"))
    await waitFor(() => expect(screen.getByTestId("preset-switcher")).toHaveTextContent(/开发工程师/))

    await user.click(screen.getByRole("button", { name: /会话/ }))
    await user.click(await screen.findByText("PM 会话"))
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("s-pm"))
    await waitFor(() => expect(screen.getByTestId("preset-switcher")).toHaveTextContent(/设计工程师/))
  })

  it("legacy mode: new session calls startSession (preset only), resets chat and marks current", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    render(<ChatPane agentClient={fake.client} />)
    await waitFor(() => expect(screen.getByText(/当前上下文/)).toBeInTheDocument())

    act(() => fake.emit({ type: "user-message", text: "旧消息" }))
    expect(await screen.findByText("旧消息")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /会话/ }))
    await user.click(await screen.findByText("新建会话"))
    await waitFor(() => expect(fake.startSessionSpy).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText("旧消息")).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/当前上下文/)).toBeInTheDocument())
    expect(screen.queryByText("新建会话")).not.toBeInTheDocument()

    fake.sessions.push({
      id: "s-new",
      createdAt: "2026-08-28T11:00:00.000Z",
      cwd: null,
      title: "新会话",
      live: false,
    })
    await user.click(screen.getByRole("button", { name: /会话/ }))
    expect(await screen.findByTestId("session-current-s-new")).toBeInTheDocument()
  })

  it("bound mode: 隐藏新建会话，下拉仅当前项目会话且任务会话带标记", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    fake.sessions.push(
      { id: "pm-a", createdAt: "2026-08-28T10:00:00.000Z", cwd: "/ws/a", title: "项目经理", live: true },
      { id: "task-x1", createdAt: "2026-08-28T11:00:00.000Z", cwd: "/ws/a", title: "实现导出", live: true },
      { id: "s-other", createdAt: "2026-08-28T12:00:00.000Z", cwd: "/ws/b", title: "别的项目", live: true },
    )
    render(<ChatPane agentClient={fake.client} projectId="prjA" workspacePath="/ws/a" />)
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("pm-a"))
    // 聊天头显示当前工作区
    expect(await screen.findByTestId("chat-workspace")).toHaveTextContent("/ws/a")

    await user.click(screen.getByRole("button", { name: /会话/ }))
    expect(await screen.findByText("项目经理")).toBeInTheDocument()
    expect(screen.getByText("实现导出")).toBeInTheDocument()
    expect(screen.getByTestId("session-task-task-x1")).toBeInTheDocument()
    expect(screen.queryByText("别的项目")).not.toBeInTheDocument()
    expect(screen.queryByText("新建会话")).not.toBeInTheDocument()
  })

  it("bound mode: 切换项目触发 switchProject 解析新项目 PM 会话", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    fake.sessions.push(
      { id: "pm-a", createdAt: "2026-08-28T10:00:00.000Z", cwd: "/ws/a", title: "A 项目", live: true },
      { id: "pm-b", createdAt: "2026-08-28T12:00:00.000Z", cwd: "/ws/b", title: "B 项目", live: true },
    )
    const { rerender } = render(<ChatPane agentClient={fake.client} projectId="prjA" workspacePath="/ws/a" />)
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("pm-a"))

    rerender(<ChatPane agentClient={fake.client} projectId="prjB" workspacePath="/ws/b" />)
    await waitFor(() => expect(fake.switchToSpy).toHaveBeenCalledWith("pm-b"))

    await user.click(screen.getByRole("button", { name: /会话/ }))
    expect(await screen.findByText("B 项目")).toBeInTheDocument()
    expect(screen.queryByText("A 项目")).not.toBeInTheDocument()
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

  it("shows stop button while thinking and cancels the agent on click", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient([
      { type: "user-message", text: "跑长任务" },
      { type: "turn", at: "start" },
    ])
    render(<ChatPane agentClient={fake.client} />)
    expect(await screen.findByText(/当前上下文/)).toBeInTheDocument()

    const box = screen.getByPlaceholderText(/给 Octo Agent 下指令/)
    await user.type(box, "跑长任务")
    await user.keyboard("{Enter}")

    const stop = await screen.findByTestId("stop-thinking")
    await user.click(stop)
    await waitFor(() => expect(fake.cancelSpy).toHaveBeenCalledOnce())

    act(() => fake.emit({ type: "turn", at: "end" }))
    act(() => fake.emit({ type: "status", status: "idle" }))
    await waitFor(() => expect(screen.queryByTestId("stop-thinking")).not.toBeInTheDocument())
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

  it("preset switcher lists presets by name and description and new session forwards the selection", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    render(<ChatPane agentClient={fake.client} />)
    const trigger = await screen.findByTestId("preset-switcher")
    await waitFor(() => expect(fake.listPresetsSpy).toHaveBeenCalled())

    await user.click(trigger)
    const option = await screen.findByTestId("preset-option-octopus-designer")
    expect(option).toHaveTextContent("设计工程师")
    expect(option).toHaveTextContent("专注设计与评审")
    await user.click(option)
    await waitFor(() => expect(trigger).toHaveTextContent("预设：设计工程师"))

    await user.click(screen.getByTestId("session-switcher"))
    await user.click(await screen.findByTestId("session-new"))
    await waitFor(() => expect(fake.startSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agentPreset: "octopus-designer" }),
    ))
  })

  it("preset model settings saves provider/model and refreshes preset list", async () => {
    const user = userEvent.setup()
    const fake = createFakeClient()
    render(<ChatPane agentClient={fake.client} />)
    const trigger = await screen.findByTestId("preset-switcher")
    await waitFor(() => expect(fake.listPresetsSpy).toHaveBeenCalled())

    await user.click(trigger)
    await user.click(await screen.findByTestId("preset-model-settings"))

    await user.clear(screen.getByTestId("preset-model-input"))
    await user.type(screen.getByTestId("preset-model-input"), "deepseek-reasoner")
    await user.clear(screen.getByTestId("preset-provider-input"))
    await user.type(screen.getByTestId("preset-provider-input"), "deepseek-official")
    await user.click(screen.getByTestId("preset-model-save"))

    await waitFor(() => expect(fake.savePresetModelSpy).toHaveBeenCalledWith(
      "octopus-developer",
      { provider: "deepseek-official", model: "deepseek-reasoner" },
    ))
    await waitFor(() => expect(fake.listPresetsSpy.mock.calls.length).toBeGreaterThan(1))
  })

  it("preset dropdown shows per-agent model when set", async () => {
    const listPresetsSpy = vi.fn(async () => [
      { id: "octopus-developer", name: "开发工程师", description: "编码", model: "deepseek-v4-flash" },
    ])
    const client = { ...createFakeClient().client, listPresets: listPresetsSpy }
    const user = userEvent.setup()
    render(<ChatPane agentClient={client} />)
    await user.click(await screen.findByTestId("preset-switcher"))
    expect(await screen.findByTestId("preset-model-octopus-developer")).toHaveTextContent("deepseek-v4-flash")
  })
})
