import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, createUser, deleteUser, listUsers, patchUser } from "./api.js"

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  )
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe("api 封装", () => {
  it("listUsers 解析 users 数组", async () => {
    mockFetchOnce(200, { users: [{ id: "1", username: "a", role: "user", disabled: false, createdAt: 1 }] })
    await expect(listUsers()).resolves.toHaveLength(1)
  })

  it("错误响应抛 ApiError 并携带状态码与 code", async () => {
    mockFetchOnce(409, { error: "conflict", message: "用户名已存在" })
    await expect(createUser({ username: "a", password: "longenough1", role: "user" }))
      .rejects.toBeInstanceOf(ApiError)
    const err = await createUser({ username: "a", password: "longenough1", role: "user" }).catch((e) => e)
    expect(err.status).toBe(409)
    expect(err.code).toBe("conflict")
  })

  it("patchUser/deleteUser 发送正确方法与路径", async () => {
    const fn = mockFetchOnce(200, { ok: true })
    await patchUser("uid", { disabled: true })
    expect(fn.mock.calls[0][0]).toBe("/api/octopus-auth/users/uid")
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe("PATCH")
    await deleteUser("uid")
    expect((fn.mock.calls[1][1] as RequestInit).method).toBe("DELETE")
  })
})
