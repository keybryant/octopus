import { describe, expect, it } from "vitest"
import { appendEvent, createProjectState, projectEvents, tailEvents, type SessionEventLike } from "./sync.js"

const ev = (type: string, data: Record<string, unknown> = {}, seq = 1): SessionEventLike => ({ seq, type, data })

describe("projectEvents", () => {
  it("user/message 投影（过滤 plugin 来源）", () => {
    const st = createProjectState()
    expect(projectEvents(st, ev("user/message", { text: "你好" }))).toEqual([{ type: "user-message", text: "你好" }])
    expect(projectEvents(st, ev("user/message", { source: { kind: "plugin" }, text: "x" }))).toEqual([])
    expect(projectEvents(st, ev("user/message", { content: [{ type: "text", text: "内容" }] }))).toEqual([{ type: "user-message", text: "内容" }])
  })

  it("assistant/message 逐块投影 text 与 tool-call（记录 callId→name 映射）", () => {
    const st = createProjectState()
    const events = projectEvents(st, ev("assistant/message", {
      message: {
        content: [
          { type: "text", text: "开始" },
          { type: "tool-call", id: "call-1", name: "create_requirement", arguments: '{"title":"x","action":"create"}' },
        ],
      },
    }))
    expect(events).toEqual([
      { type: "assistant-text", text: "开始" },
      { type: "tool-call", name: "create_requirement", summary: expect.stringContaining("create") },
    ])
    expect(st.callNames.get("call-1")).toBe("create_requirement")
  })

  it("tool/result 用 callNames 反查名；error 存在时 ok=false", () => {
    const st = createProjectState()
    st.callNames.set("call-1", "list_tasks")
    expect(projectEvents(st, ev("tool/result", { message: { content: [{ toolCallId: "call-1", content: ["ok"] }] } }))).toEqual([
      { type: "tool-result", name: "list_tasks", ok: true, preview: expect.stringContaining("ok") },
    ])
    expect(projectEvents(st, ev("tool/result", { error: {}, message: { content: [] } }))).toEqual([
      { type: "tool-result", name: "tool", ok: false, preview: expect.stringContaining("[]") },
    ])
  })

  it("turn/start、turn/end（reason 透传）、未知类型返回空数组", () => {
    const st = createProjectState()
    expect(projectEvents(st, ev("turn/start"))).toEqual([{ type: "turn", at: "start" }])
    expect(projectEvents(st, ev("turn/end", { reason: { kind: "completed" } }))).toEqual([{ type: "turn", at: "end", reason: "completed" }])
    expect(projectEvents(st, ev("whatever/unknown"))).toEqual([])
  })
})

describe("appendEvent / tailEvents", () => {
  it("appendEvent 超限裁剪头部", () => {
    const buffer = [] as { type: "status"; status: "idle" }[]
    let current: { type: "status"; status: "idle" }[] = buffer
    for (let i = 0; i < 103; i += 1) current = appendEvent(current, { type: "status", status: "idle" }, 100)
    expect(current).toHaveLength(100)
    expect(tailEvents(current, 3)).toHaveLength(3)
  })

  it("tailEvents 默认取尾 15 条", () => {
    const buffer = Array.from({ length: 30 }, (_, i) => ({ type: "status" as const, status: "idle" as const }))
    expect(tailEvents(buffer)).toHaveLength(15)
    expect(tailEvents(buffer, 100)).toHaveLength(30)
  })
})
