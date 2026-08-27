import { describe, expect, it, vi } from "vitest"
import { apply, name, inject } from "./index.js"

describe("octopus-users plugin", () => {
  it("声明与契约一致", () => {
    expect(name).toBe("octopus-users")
    expect(inject).toEqual(["storage"])
  })

  it("提供 users 服务并解析 json 后端", () => {
    const provide = vi.fn()
    const backendGet = vi.fn(() => ({ kv: undefined, close: async () => undefined }))
    const ctx: any = {
      storage: { backend: { get: backendGet } },
      provide,
      effect: vi.fn(),
    }
    apply(ctx)
    expect(provide).toHaveBeenCalledWith("users", expect.objectContaining({
      createUser: expect.any(Function),
    }))
    expect(backendGet).toHaveBeenCalledWith("json")
  })
})
