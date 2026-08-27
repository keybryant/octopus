import { describe, expect, it } from "vitest"
import { generateTaskDrafts } from "./decompose.js"

describe("generateTaskDrafts（mock AI 拆解）", () => {
  it("默认生成三步草稿：实现 / 联调测试 / 验收上线", () => {
    const drafts = generateTaskDrafts({ title: "OAuth 2.0 重构" })
    expect(drafts.map((d) => d.title)).toEqual([
      "实现OAuth 2.0 重构 · 核心逻辑",
      "OAuth 2.0 重构 · 联调与测试",
      "OAuth 2.0 重构 · 验收与上线准备",
    ])
    expect(drafts[0].priority).toBe("P1")
    expect(drafts[0].description).toBe("")
    expect(drafts[2].priority).toBe("P2")
  })

  it("P0 需求前置排期草稿，并携带描述", () => {
    const drafts = generateTaskDrafts({ title: "认证重构", priority: "P0", description: "无感登录" })
    expect(drafts).toHaveLength(4)
    expect(drafts[0].title).toBe("排期与拆解 认证重构")
    expect(drafts[0].priority).toBe("P0")
    expect(drafts[1].title).toBe("实现认证重构 · 核心逻辑")
    expect(drafts[1].description).toBe("无感登录")
  })
})
