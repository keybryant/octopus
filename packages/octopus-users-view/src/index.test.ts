import { describe, expect, it, vi } from "vitest"
import { apply } from "./index.js"

describe("octopus-users-view", () => {
  it("注册 admin 可见的用户管理卡片并托管资源路由", () => {
    const workbench = { register: vi.fn(() => vi.fn()) }
    const webServer = { register: vi.fn(() => vi.fn()) }
    const ctx: any = { workbench, webServer, effect: vi.fn((f: () => () => void) => f()) }
    apply(ctx)
    expect(workbench.register).toHaveBeenCalledWith({
      id: "users-view",
      title: "用户管理",
      order: 900,
      entry: "/octopus/users-view/assets/index.js",
    })
    expect(webServer.register).toHaveBeenCalledWith(expect.objectContaining({
      kind: "prefix",
      path: "/octopus/users-view/assets",
    }))
  })
})
