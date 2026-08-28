import { describe, expect, it } from "vitest"
import { EventIndex } from "./events-index.js"

describe("EventIndex", () => {
  it("appends with monotonic idx", () => {
    const idx = new EventIndex()
    expect(idx.lastIdx).toBe(-1)
    expect(idx.append({ type: "status", status: "running" })).toBe(0)
    expect(idx.append({ type: "user-message", text: "hi" })).toBe(1)
    expect(idx.list()).toHaveLength(2)
    expect(idx.list(1)).toEqual([{ idx: 1, type: "user-message", text: "hi" }])
  })
  it("rebuild only when empty and continues ids", () => {
    const idx = new EventIndex()
    idx.appendAll([
      { type: "user-message", text: "a" },
      { type: "assistant-text", text: "b" },
    ])
    expect(idx.lastIdx).toBe(1)
    expect(idx.list()).toHaveLength(2)
    expect(() => idx.appendAll([{ type: "status", status: "idle" }])).toThrow()
    expect(idx.append({ type: "turn", at: "end" })).toBe(2)
  })
})
