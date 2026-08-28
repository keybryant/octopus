import { render, screen, waitFor } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { AgentClient, AgentReply, Artifact } from "../lib/types"
import { ChatPane } from "./ChatPane"

function instantClient(reply: Partial<AgentReply> = {}): AgentClient {
  return {
    reply: vi.fn().mockResolvedValue({
      blocks: [{ kind: "paragraph", segs: [{ text: "收到" }] }],
      ...reply,
    }),
    startSession: async () => "mock",
    switchTo: async () => undefined,
    listSessions: async () => [],
    history: async () => [],
    subscribe: () => () => undefined,
    send: async () => undefined,
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
    const artifact = {
      id: "art-x",
      kind: "task" as const,
      title: "TASK-9000",
      subtitle: "新产出",
    }
    render(<ChatPane agentClient={instantClient({ artifacts: [artifact] })} onArtifactsChange={onArtifactsChange} />)

    const box = screen.getByPlaceholderText(/给 Octo Agent 下指令/)
    fireEvent.input(box, { target: { value: "跑起来" } })
    fireEvent.keyDown(box, { key: "Enter" })

    await waitFor(() => {
      const last: Artifact[] = onArtifactsChange.mock.lastCall?.[0] ?? []
      expect(last.some((a) => a.id === "art-x")).toBe(true)
    })
  })
})
