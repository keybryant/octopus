import { describe, expect, it } from "vitest"
import { KANBAN_COLUMNS, PROJECTS, QUICK_PROMPTS, currentProject } from "./datasource"

describe("datasource", () => {
  it("current project is Octopus Platform with v5 metrics", () => {
    const p = currentProject()
    expect(p.name).toBe("Octopus Platform")
    expect(p.shortName).toBe("OP")
    expect(p.iteration).toBe("迭代 4.2 · 第 2 周")
    expect(p.progressPct).toBe(78)
    expect(p.weeklyDone).toBe(28)
    expect(p.weeklyTotal).toBe(40)
    expect(p.activeRequirements).toBe(24)
    expect(p.overdue).toBe(3)
    expect(p.dueDate).toBe("10-31")
    expect(p.members).toHaveLength(8) // 头像叠前3个 + "+5"
  })

  it("has three projects with unique ids and OP first", () => {
    expect(PROJECTS.map((p) => p.id)).toEqual(["octopus-platform", "merchant-portal", "data-core"])
  })

  it("kanban covers four columns in order", () => {
    expect(KANBAN_COLUMNS.map((c) => c.key)).toEqual(["todo", "doing", "review", "done"])
    expect(KANBAN_COLUMNS.flatMap((c) => c.tasks).some((t) => t.agentRun)).toBe(true)
  })

  it("quick prompts match v5 chips", () => {
    expect(QUICK_PROMPTS[0]).toBe("📋 列出今日待办")
    expect(QUICK_PROMPTS).toHaveLength(5)
  })
})