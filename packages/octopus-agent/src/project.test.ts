import { describe, expect, it } from "vitest"
import { createProjectState, projectEvents, toStreamEvent, deriveTitle, type SessionEventLike } from "./project.js"

function ev(seq: number, type: string, data: Record<string, unknown>): SessionEventLike {
  return { seq, time: 1000, type, data }
}

describe("projectEvents", () => {
  it("projects user message and assistant text", () => {
    const st = createProjectState()
    const user = projectEvents(st, ev(0, "user/message", { text: "hi" }))
    expect(user).toHaveLength(1)
    expect(toStreamEvent(user[0])).toMatchObject({ type: "user-message", text: "hi" })
    const asst = projectEvents(st, ev(1, "assistant/message", {
      message: { content: [{ type: "text", text: "hello" }, { type: "tool-call", id: "c1", name: "run_pwsh", arguments: "{}" }] },
      turn: 1, step: 1,
    }))
    expect(asst).toHaveLength(2)
    expect(toStreamEvent(asst[0])).toMatchObject({ type: "assistant-text", text: "hello" })
    expect(toStreamEvent(asst[1])).toMatchObject({ type: "tool-call", callId: "c1", name: "run_pwsh" })
    const tool = projectEvents(st, ev(2, "assistant/message", {
      message: { content: [{ type: "tool-call", id: "c1", name: "run_pwsh", arguments: "{}" }] },
      turn: 1, step: 1,
    }))
    expect(tool).toHaveLength(1)
    expect(toStreamEvent(tool[0])).toMatchObject({ type: "tool-call", callId: "c1", name: "run_pwsh" })
  })
  it("projects tool result with resolved name", () => {
    const st = createProjectState()
    projectEvents(st, ev(0, "assistant/message", { message: { content: [{ type: "tool-call", id: "c1", name: "str_replace_editor", arguments: "{}" }] }, turn: 1, step: 1 }))
    const r = projectEvents(st, ev(1, "tool/result", { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "ok done" }] }] }, error: undefined }))
    expect(r).toHaveLength(1)
    const v = toStreamEvent(r[0])
    expect(v).toMatchObject({ type: "tool-result", callId: "c1", name: "str_replace_editor", ok: true })
    expect(v).toMatchObject({ preview: expect.stringContaining("ok done") })
  })
  it("projects turn boundaries and approval audit", () => {
    const st = createProjectState()
    const t = projectEvents(st, ev(0, "turn/start", { turn: 1 }))
    expect(t).toHaveLength(1)
    expect(toStreamEvent(t[0])).toMatchObject({ type: "turn", at: "start" })
    const a = projectEvents(st, ev(1, "approval/asked", { id: "a1", toolName: "fs_write", reason: "write outside workspace?" }))
    expect(a).toHaveLength(1)
    expect(toStreamEvent(a[0])).toMatchObject({ type: "approval", id: "a1", toolName: "fs_write" })
  })
  it("ignores chunk and unknown events", () => {
    const st = createProjectState()
    expect(projectEvents(st, ev(0, "assistant/chunk", { chunk: {} }))).toEqual([])
    expect(projectEvents(st, ev(1, "weird/event", { x: 1 }))).toEqual([])
  })
  it("derives title from first user text and null when absent", () => {
    const st = createProjectState()
    const evs = [
      ...projectEvents(st, ev(0, "user/message", { text: "给我列出所有待办任务并汇总到周报文档" })),
      ...projectEvents(st, ev(1, "assistant/message", { message: { content: [{ type: "text", text: "好" }] }, turn: 1, step: 1 })),
    ]
    expect(deriveTitle(evs)).toContain("给我列出所有待办任务")
    expect(deriveTitle([])).toBe(null)
  })
  it("splits assistant message with text and tool-call into two captured events", () => {
    const st = createProjectState()
    const evs = projectEvents(st, ev(0, "assistant/message", {
      message: { content: [{ type: "text", text: "let me check" }, { type: "tool-call", id: "c1", name: "run_pwsh", arguments: "{}" }] },
      turn: 1, step: 1,
    }))
    expect(evs).toHaveLength(2)
    expect(evs.map((e) => e.type)).toEqual(["assistant-text", "tool-call"])
  })
})
