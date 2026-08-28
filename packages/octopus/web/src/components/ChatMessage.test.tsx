import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "../lib/types"
import { ChatMessage as V } from "./ChatMessage"

describe("ChatMessage", () => {
  it("renders user text in right-aligned bubble", () => {
    render(<V message={{ id: "u1", role: "user", time: "14:35", text: "列出优先事项" }} />)
    const bubble = screen.getByTestId("msg-user")
    expect(bubble).toHaveTextContent("列出优先事项")
    expect(screen.queryByText(/gpt-4/)).not.toBeInTheDocument()
  })

  it("renders paragraph with accent segments", () => {
    render(
      <V
        message={{
          id: "m1",
          role: "assistant",
          time: "14:29",
          blocks: [
            {
              kind: "paragraph",
              segs: [
                { text: "接管 " },
                { text: "TASK-2850", accent: "green" },
                { text: " 与 " },
                { text: "风险项", accent: "strong" },
              ],
            },
          ],
        }}
      />,
    )
    expect(screen.getByText("TASK-2850").className).toContain("text-accent")
    expect(screen.getByText("风险项").className).toContain("font-medium")
  })

  it("renders priority cards with badge and action", () => {
    render(
      <V
        message={{
          id: "m2",
          role: "assistant",
          time: "14:29",
          meta: "14:29 · gpt-4 · 1.2s",
          blocks: [
            {
              kind: "cards",
              cards: [
                {
                  badge: { label: "逾期", tone: "orange" },
                  title: "TASK-2850",
                  hint: "阻塞 REQ-118",
                  actionLabel: "让 Agent 接手 →",
                },
              ],
            },
          ],
        }}
      />,
    )
    expect(screen.getByText("逾期")).toBeInTheDocument()
    expect(screen.getByText("让 Agent 接手 →")).toBeInTheDocument()
    expect(screen.getByText(/gpt-4/)).toBeInTheDocument()
  })

  it("renders step states distinctly", () => {
    render(
      <V
        message={{
          id: "m3",
          role: "assistant",
          time: "14:31",
          blocks: [
            {
              kind: "steps",
              items: [
                { state: "done", text: "升级依赖" },
                { state: "active", text: "回归测试中…" },
                { state: "pending", text: "输出报告" },
              ],
            },
          ],
        }}
      />,
    )
    expect(screen.getAllByTestId("step-done")).toHaveLength(1)
    expect(screen.getAllByTestId("step-active")).toHaveLength(1)
    expect(screen.getAllByTestId("step-pending")).toHaveLength(1)
  })

  it("renders bullets, actions, code and notice blocks", () => {
    render(
      <V
        message={{
          id: "m4",
          role: "assistant",
          time: "14:40",
          blocks: [
            { kind: "bullets", items: [[{ text: "第一条" }], [{ text: "第二条" }]] },
            { kind: "code", filename: "token-cache.ts", code: "const cache = new LRUCache()" },
            { kind: "notice", title: "已创建任务 TASK-2851", hint: "指派给 张三 · P1" },
            { kind: "actions", actions: ["暂停执行", "查看日志"] },
          ],
        }}
      />,
    )
    expect(screen.getByText("token-cache.ts")).toBeInTheDocument()
    expect(screen.getByText(/LRUCache/)).toBeInTheDocument()
    expect(screen.getByText("已创建任务 TASK-2851")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "暂停执行" })).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })

  it("renders approval block with title, reason and allow/deny buttons", () => {
    const onApprovalDecision = vi.fn()
    render(
      <V
        message={{
          id: "m5",
          role: "assistant",
          time: "14:41",
          blocks: [{ kind: "approval", approvalId: "a1", toolName: "bash", reason: "运行测试脚本" }],
        }}
        onApprovalDecision={onApprovalDecision}
      />,
    )
    const box = screen.getByTestId("approval-a1")
    expect(box).toHaveTextContent("bash")
    expect(box).toHaveTextContent("运行测试脚本")
    expect(screen.getByRole("button", { name: "允许" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument()
  })

  it("clicking allow calls onApprovalDecision with the id and allow", () => {
    const onApprovalDecision = vi.fn()
    render(
      <V
        message={{
          id: "m6",
          role: "assistant",
          time: "14:41",
          blocks: [{ kind: "approval", approvalId: "a1", toolName: "bash" }],
        }}
        onApprovalDecision={onApprovalDecision}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "允许" }))
    expect(onApprovalDecision).toHaveBeenCalledWith("a1", "allow")
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }))
    expect(onApprovalDecision).toHaveBeenCalledWith("a1", "deny")
  })

  it("disables both approval buttons when the id is decided", () => {
    render(
      <V
        message={{
          id: "m7",
          role: "assistant",
          time: "14:41",
          blocks: [{ kind: "approval", approvalId: "a1", toolName: "bash" }],
        }}
        decidedApprovalIds={new Set(["a1"])}
      />,
    )
    expect(screen.getByRole("button", { name: "允许" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "拒绝" })).toBeDisabled()
  })

  it("renders danger notice with danger styles and keeps info notice unchanged", () => {
    render(
      <V
        message={{
          id: "m8",
          role: "assistant",
          time: "14:42",
          blocks: [
            { kind: "notice", title: "写入失败", hint: "permission denied", tone: "danger" },
            { kind: "notice", title: "已创建任务 TASK-2852", hint: "指派给 张三" },
          ],
        }}
      />,
    )
    const danger = screen.getByTestId("notice-danger")
    expect(danger).toHaveTextContent("写入失败")
    expect(danger.querySelector(".text-danger")).not.toBeNull()
    expect(danger.className).toContain("border-danger/40")
    expect(danger.className).toContain("bg-danger/10")
    const info = screen.getByText("已创建任务 TASK-2852")
    expect(info.className).toContain("text-accent")
  })
})
