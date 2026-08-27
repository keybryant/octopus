import { describe, expect, it } from "vitest"
import { REQUIREMENT_STATUSES, REQUIREMENT_TRANSITIONS } from "../../src/types"
import { STATUS_ORDER, TRANSITIONS } from "./status"

/**
 * 前后端状态机漂移测试：后端 src/types.ts 是状态机的唯一权威，
 * 前端 status.ts 修改状态集合或迁移表时必须同步后端，此测试保证二者一致。
 */
describe("前端状态机与后端同步", () => {
  it("状态集合一致", () => {
    expect([...STATUS_ORDER].sort()).toEqual([...REQUIREMENT_STATUSES].sort())
  })

  it("迁移表一致", () => {
    expect(TRANSITIONS).toEqual(REQUIREMENT_TRANSITIONS)
  })
})
