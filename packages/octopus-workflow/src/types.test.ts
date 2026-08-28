import { describe, expect, it } from "vitest"
import { WorkflowError } from "./types.js"

describe("WorkflowError", () => {
  it("携带 code 与 message", () => {
    const err = new WorkflowError("task-not-found", "task TASK-1 not found")
    expect(err.code).toBe("task-not-found")
    expect(err.message).toContain("TASK-1")
    expect(err).toBeInstanceOf(Error)
  })
})
