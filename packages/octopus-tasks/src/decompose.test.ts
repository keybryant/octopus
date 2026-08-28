import { describe, expect, it } from "vitest"
import { generateTaskDrafts } from "./decompose.js"

describe("generateTaskDrafts（mock AI 拆解）", () => {
  it("固定生成三步草稿：实现 / 联调测试 / 验收上线，无额外字段", () => {
    const drafts = generateTaskDrafts({ title: "OAuth 2.0 重构" })
    expect(drafts).toEqual([
      { title: "实现OAuth 2.0 重构 · 核心逻辑", description: "" },
      { title: "OAuth 2.0 重构 · 联调与测试" },
      { title: "OAuth 2.0 重构 · 验收与上线准备" },
    ])
  })

  it("传入描述时首条草稿携带描述，且条数仍为 3", () => {
    const drafts = generateTaskDrafts({ title: "认证重构", description: "无感登录" })
    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toEqual({ title: "实现认证重构 · 核心逻辑", description: "无感登录" })
  })
})
