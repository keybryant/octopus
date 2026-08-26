import { describe, expect, it, vi } from "vitest"
import { apply, resolveAuthConfig } from "./index.js"
import { createFakeUsers, createRes } from "./testing.js"
import { hashPassword } from "./hash.js"

function setup(partial: Parameters<typeof resolveAuthConfig>[0] = {}) {
  const register = vi.fn(() => vi.fn())
  const users = createFakeUsers()
  const ctx: any = {
    webServer: { register },
    users,
    effect: vi.fn((fn: Function) => fn()),
    provide: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn() },
  }
  apply(ctx, partial)
  const routes = new Map(register.mock.calls.map((c: any[]) => [`${c[0].kind} ${c[0].path}`, c[0]]))
  return { ctx, users, routes }
}

async function seedAdmin(users: ReturnType<typeof createFakeUsers>) {
  await users.createUser({ username: "boss", passwordHash: "", role: "admin" })
  const boss = (await users.findByUsername("boss"))!
  await users.updateUser(boss.id, { passwordHash: await hashPassword("passw0rd!") })
}

describe("octopus-auth apply", () => {
  it("注册预期路由并提供 auth 服务", () => {
    const { ctx, routes } = setup()
    expect(ctx.provide).toHaveBeenCalledWith("auth", expect.objectContaining({
      requireAuth: expect.any(Function),
      requireAdmin: expect.any(Function),
    }))
    expect([...routes.keys()].sort()).toEqual([
      "exact /api/octopus-auth/login",
      "exact /api/octopus-auth/logout",
      "exact /api/octopus-auth/me",
      "exact /api/octopus-auth/verify",
      "exact /api/octopus-auth/users",
      "exact /login",
      "prefix /api/octopus-auth/users/",
    ].sort())
  })

  it("verify：无会话 401", async () => {
    const { routes } = setup()
    const res = createRes()
    await routes.get("exact /api/octopus-auth/verify")!.handler({ method: "GET", headers: {} }, res)
    expect(res.calls[0].status).toBe(401)
  })

  it("登录页公开且 needsSetup 动态渲染", async () => {
    const { users, routes } = setup()
    const emptyRes = createRes()
    await routes.get("exact /login")!.handler({ method: "GET", headers: {} }, emptyRes)
    expect(emptyRes.calls[0].status).toBe(200)
    expect(emptyRes.calls[0].body).toContain("尚未配置初始管理员")
    await seedAdmin(users)
    const readyRes = createRes()
    await routes.get("exact /login")!.handler({ method: "GET", headers: {} }, readyRes)
    expect(readyRes.calls[0].body).not.toContain("尚未配置初始管理员")
  })

  it("登录成功 Set-Cookie；me 返回用户与 canLogout=true", async () => {
    const { users, routes } = setup()
    await seedAdmin(users)
    const loginRes = createRes()
    await routes.get("exact /api/octopus-auth/login")!.handler(
      {
        method: "POST", url: "/api/octopus-auth/login",
        headers: { origin: "http://localhost", host: "localhost" },
        socket: { remoteAddress: "ip-a" },
      } as any, loginRes,
      JSON.stringify({ username: "boss", password: "passw0rd!" }),
    )
    expect(loginRes.calls[0].status).toBe(200)
    const cookie = loginRes.calls[0].headers["set-cookie"]!
    expect(cookie).toMatch(/^octopus_session=[A-Za-z0-9_-]+/)
    const meRes = createRes()
    await routes.get("exact /api/octopus-auth/me")!.handler(
      { method: "GET", headers: { cookie } } as any, meRes,
    )
    const body = JSON.parse(meRes.calls[0].body)
    expect(body.user.username).toBe("boss")
    expect(body.canLogout).toBe(true)
  })

  it("single-user：me 直通且 canLogout=false，login 返回 400", async () => {
    const { routes } = setup({ mode: "single-user" })
    const meRes = createRes()
    await routes.get("exact /api/octopus-auth/me")!.handler({ method: "GET", headers: {} } as any, meRes)
    const body = JSON.parse(meRes.calls[0].body)
    expect(body.user.username).toBe("local")
    expect(body.canLogout).toBe(false)
    const loginRes = createRes()
    await routes.get("exact /api/octopus-auth/login")!.handler(
      { method: "POST", url: "/x", headers: { origin: "http://h", host: "h" } } as any, loginRes,
      JSON.stringify({ username: "a", password: "b" }),
    )
    expect(loginRes.calls[0].status).toBe(400)
  })

  it("bootstrap：空表 + bootstrapAdmin 配置自动建号", async () => {
    const register = vi.fn(() => vi.fn())
    const users = createFakeUsers()
    const ctx: any = {
      webServer: { register }, users,
      effect: vi.fn((fn: Function) => fn()), provide: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn() },
    }
    apply(ctx, { bootstrapAdmin: { username: "founder", password: "founder-pass1" } })
    await vi.waitFor(async () => {
      const found = await users.findByUsername("founder")
      if (!found) throw new Error("not yet")
      expect(found.role).toBe("admin")
    })
  })
})
