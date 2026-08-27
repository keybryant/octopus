import { describe, expect, it } from "vitest"
import { KANBAN_COLUMNS, PROJECTS, QUICK_PROMPTS, REQUIREMENTS, currentProject } from "./datasource"

describe("datasource", () => {
  it("current project is Octopus Platform with v5 metrics", () => {
    const p = currentProject()
    expect(p.name).toBe("Octopus Platform")
    expect(p.shortName).toBe("OP")
    expect(p.progressPct).toBe(78)
    expect(p.weeklyDone).toBe(28)
    expect(p.weeklyTotal).toBe(40)
    expect(p.activeRequirements).toBe(24)
    expect(p.overdue).toBe(3)
    expect(p.members).toHaveLength(8) // 头像叠前3个 + "+5"
  })

  it("has three projects with unique ids and OP first", () => {
    expect(PROJECTS.map((p) => p.id)).toEqual(["octopus-platform", "merchant-portal", "data-core"])
  })

  it("kanban covers four columns in order", () => {
    expect(KANBAN_COLUMNS.map((c) => c.key)).toEqual(["todo", "doing", "review", "done"])
    expect(KANBAN_COLUMNS.flatMap((c) => c.tasks).some((t) => t.agentRun)).toBe(true)
  })

  it("requirements table has REQ-118..115 rows", () => {
    expect(REQUIREMENTS.map((r) => r.id)).toEqual(["REQ-118", "REQ-121", "REQ-124", "REQ-115"])
  })

  it("quick prompts match v5 chips", () => {
    expect(QUICK_PROMPTS[0]).toBe("📋 列出今日待办")
    expect(QUICK_PROMPTS).toHaveLength(5)
  })
})
