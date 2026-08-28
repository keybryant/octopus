import { render, screen, waitFor } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { AgentClient, AgentStreamEvent, Artifact } from "../lib/types"
import { ChatPane } from "./ChatPane"

/** 与 agent-client.ts 相同的 Distributive Omit（直接 Omit 无法用于交集联合类型） */
type WithoutIdx<T> = T extends AgentStreamEvent ? Omit<T, "idx"> : never
type ScriptedEvent = WithoutIdx<AgentStreamEvent>

function instantClient(events?: ScriptedEvent[]): AgentClient {
  let idx = 0
  let handler: ((ev: AgentStreamEvent) => void) | null = null
  const emit = (ev: ScriptedEvent) => {
    const next: AgentStreamEvent = { ...ev, idx: ++idx } as AgentStreamEvent
    if (handler) handler(next)
  }
  return {
    reply: vi.fn().mockResolvedValue({
      blocks: [{ kind: "paragraph", segs: [{ text: "收到" }] }],
    }),
    startSession: async () => "mock",
    switchTo: async () => undefined,
    listSessions: async () => [],
    history: async () => [],
    subscribe: (h) => {
      handler = h
      return () => {
        handler = null
      }
    },
    send: async (text: string) => {
      const script = events ?? [
        { type: "user-message", text },
        { type: "turn", at: "start" },
        { type: "assistant-text", text: "收到" },
        { type: "turn", at: "end" },
        { type: "status", status: "idle" },
      ]
      for (const ev of script) emit(ev)
    },
    cancel: async () => undefined,
    disposeSession: async () => undefined,
    answerApproval: async () => undefined,
  }
}

describe("ChatPane", () => {
  it("full flow: welcome → type & send → assistant reply appears", async () => {
    render(<ChatPane agentClient={instantClient()} />)
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
        agentClient={instantClient([
          { type: "user-message", text: "跑起来" },
          { type: "turn", at: "start" },
          { type: "assistant-text", text: "收到" },
          { type: "tool-call", callId: "art-x", name: "str_replace_editor", summary: "TASK-9000 新产出" },
          { type: "turn", at: "end" },
          { type: "status", status: "idle" },
        ])}
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
})
