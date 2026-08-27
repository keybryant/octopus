import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createMockAgentClient } from "./agent-client"
import type { AgentClient, AgentReply } from "./types"
import { useChat } from "./use-chat"

describe("useChat", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("seeds welcome message mentioning project context", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0))
    const { result } = renderHook(() => useChat(createMockAgentClient(0)))
    const welcome = result.current.messages[0]
    expect(welcome.role).toBe("assistant")
    expect(welcome.text).toContain("早上好")
    expect(welcome.text).toContain("Octopus Platform")
    expect(result.current.status).toBe("idle")
  })

  it("send appends user message then assistant reply and artifacts", async () => {
    const { result } = renderHook(() => useChat(createMockAgentClient(5)))
    act(() => result.current.send("先列一下优先事项"))
    expect(result.current.status).toBe("thinking")
    expect(result.current.messages.at(-1)?.role).toBe("user")

    await waitFor(() => expect(result.current.status).toBe("idle"))

    const replyMsg = result.current.messages.at(-1)!
    expect(replyMsg.role).toBe("assistant")
    expect(replyMsg.blocks?.some((b) => b.kind === "cards")).toBe(true)
    expect(replyMsg.meta).toMatch(/^\d{2}:\d{2} · gpt-4 · /)
    // 优先事项回复不新增产出物
    expect(result.current.artifacts).toHaveLength(4)

    // 派活回复：新增产出物（去重合并）
    act(() => result.current.send("把 TASK-2850 交给 Agent 自动跑"))
    await waitFor(() => expect(result.current.status).toBe("idle"))
    expect(result.current.messages.at(-1)?.blocks?.some((b) => b.kind === "steps")).toBe(true)
    expect(result.current.artifacts.length).toBeGreaterThanOrEqual(5)
  })

  it("ignores send while thinking", async () => {
    const { result } = renderHook(() => useChat(createMockAgentClient(20)))
    act(() => result.current.send("a"))
    act(() => result.current.send("b"))
    await waitFor(() => expect(result.current.status).toBe("idle"))
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1)
  })

  it("recovers when reply rejects and stays usable", async () => {
    const replies: Promise<AgentReply>[] = [
      Promise.reject(new Error("boom")),
      Promise.resolve({ blocks: [{ kind: "paragraph", segs: [{ text: "ok" }] }] }),
    ]
    const client: AgentClient = { reply: () => replies.shift()! }
    const { result } = renderHook(() => useChat(client))

    act(() => result.current.send("first"))
    expect(result.current.status).toBe("thinking")
    await waitFor(() => expect(result.current.status).toBe("idle"))

    const errMsg = result.current.messages.at(-1)!
    expect(errMsg.role).toBe("assistant")
    expect(errMsg.text).toContain("失败")

    // 失败后 busy 复位，可继续发送
    act(() => result.current.send("second"))
    await waitFor(() =>
      expect(result.current.messages.at(-1)?.blocks?.some((b) => b.kind === "paragraph")).toBe(true),
    )
    expect(result.current.status).toBe("idle")
  })
})
