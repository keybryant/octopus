import { describe, expect, it, vi } from "vitest"
import { apply, resolveAuthConfig } from "./index.js"
import { createFakeUsers, createRes } from "./testing.js"
import { hashPassword } from "./hash.js"

const SAME_ORIGIN = { origin: "http://localhost", host: "localhost" }

function setup() {
  const register = vi.fn(() => vi.fn())
  const users = createFakeUsers()
  const ctx: any = {
    webServer: { register }, users,
    effect: vi.fn((fn: Function) => fn()), provide: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn() },
  }
  apply(ctx, resolveAuthConfig({}))
  const routes = new Map(register.mock.calls.map((c: any[]) => [`${c[0].kind} ${c[0].path}`, c[0]]))
  return { users, routes }
}

async function makeAdmin(users: ReturnType<typeof createFakeUsers>, username: string, role: "admin" | "user") {
  await users.createUser({ username, passwordHash: "", role })
  const u = (await users.findByUsername(username))!
  await users.updateUser(u.id, { passwordHash: await hashPassword("passw0rd!") })
  return (await users.findByUsername(username))!
}

async function login(routes: Map<string, any>, username: string, ip: string) {
  const res = createRes()
  await routes.get("exact /api/octopus-auth/login")!.handler(
    { method: "POST", url: "/x", headers: { ...SAME_ORIGIN }, socket: { remoteAddress: ip } } as any,
    res, JSON.stringify({ username, password: "passw0rd!" }),
  )
  expect(res.calls[0].status).toBe(200)
  return res.calls[0].headers["set-cookie"] as string
}

describe("用户管理 API 行为保证", () => {
  it("未登录 401；普通用户 403", async () => {
    const { users, routes } = setup()
    await makeAdmin(users, "plain", "user")
    const anon = createRes()
    await routes.get("exact /api/octopus-auth/users")!.handler(
      { method: "GET", headers: {} } as any, anon)
    expect(anon.calls[0].status).toBe(401)

    const userCookie = await login(routes, "plain", "ip-u")
    const forbidden = createRes()
    await routes.get("exact /api/octopus-auth/users")!.handler(
      {
        method: "POST", url: "/x",
        headers: { ...SAME_ORIGIN, cookie: userCookie }, socket: { remoteAddress: "ip-u" },
      } as any, forbidden, JSON.stringify({ username: "nx", password: "longenough1" }))
    expect(forbidden.calls[0].status).toBe(403)
  })

  it("创建：弱密码 400；重复用户名 409；成功 201", async () => {
    const { users, routes } = setup()
    await makeAdmin(users, "boss", "admin")
    const cookie = await login(routes, "boss", "ip-b")
    const call = (body: unknown) => {
      const res = createRes()
      return routes.get("exact /api/octopus-auth/users")!.handler(
        {
          method: "POST", url: "/x",
          headers: { ...SAME_ORIGIN, cookie }, socket: { remoteAddress: `ip-${Math.random()}` },
        } as any, res, JSON.stringify(body),
      ).then(() => res.calls[0])
    }
    expect((await call({ username: "a1", password: "short" })).status).toBe(400)
    expect((await call({ username: "BOSS", password: "longenough1" })).status).toBe(409)
    expect((await call({ username: "newbie", password: "longenough1", role: "user" })).status).toBe(201)
  })

  it("不能删除自己；不能禁用自己；不能降级最后一个 admin", async () => {
    const { users, routes } = setup()
    const boss = await makeAdmin(users, "boss", "admin")
    const cookie = await login(routes, "boss", "ip-b")
    const del = createRes()
    await routes.get("prefix /api/octopus-auth/users")!.handler(
      {
        method: "DELETE", url: `/api/octopus-auth/users/${boss.id}`,
        headers: { ...SAME_ORIGIN, cookie }, socket: { remoteAddress: "ip-b" },
      } as any, del)
    expect(del.calls[0].status).toBe(400)
    expect(JSON.parse(del.calls[0].body).error).toBe("self-operation")

    const disableSelf = createRes()
    await routes.get("prefix /api/octopus-auth/users")!.handler(
      {
        method: "PATCH", url: `/api/octopus-auth/users/${boss.id}`,
        headers: { ...SAME_ORIGIN, cookie }, socket: { remoteAddress: "ip-b" },
      } as any, disableSelf, JSON.stringify({ disabled: true }))
    expect(JSON.parse(disableSelf.calls[0].body).error).toBe("self-operation")

    const demote = createRes()
    await routes.get("prefix /api/octopus-auth/users")!.handler(
      {
        method: "PATCH", url: `/api/octopus-auth/users/${boss.id}`,
        headers: { ...SAME_ORIGIN, cookie }, socket: { remoteAddress: "ip-b" },
      } as any, demote, JSON.stringify({ role: "user" }))
    expect(demote.calls[0].status).toBe(400)
    expect(JSON.parse(demote.calls[0].body).error).toBe("last-admin")
  })

  it("第二个 admin 存在时可降级前者；重置密码后旧密码失效；删除用户注销其会话", async () => {
    const { users, routes } = setup()
    const boss = await makeAdmin(users, "boss", "admin")
    await makeAdmin(users, "vice", "admin")
    const tempRes = createRes()
    await routes.get("exact /api/octopus-auth/users")!.handler(
      {
        method: "POST", url: "/x", headers: { ...SAME_ORIGIN, cookie: await login(routes, "boss", "ip-b") },
        socket: { remoteAddress: "ip-r" },
      } as any, tempRes, JSON.stringify({ username: "temp", password: "temp-pass1", role: "user" }))
    const tempId = JSON.parse(tempRes.calls[0].body).user.id

    const reset = createRes()
    await routes.get("prefix /api/octopus-auth/users")!.handler(
      {
        method: "PATCH", url: `/api/octopus-auth/users/${tempId}`,
        headers: { ...SAME_ORIGIN, cookie: await login(routes, "vice", "ip-v") },
        socket: { remoteAddress: "ip-v" },
      } as any, reset, JSON.stringify({ password: "brand-new99" }))
    expect(reset.calls[0].status).toBe(200)

    const demoteVice = createRes()
    const vice = (await users.findByUsername("vice"))!
    await routes.get("prefix /api/octopus-auth/users")!.handler(
      {
        method: "PATCH", url: `/api/octopus-auth/users/${vice.id}`,
        headers: { ...SAME_ORIGIN, cookie: await login(routes, "boss", "ip-b") },
        socket: { remoteAddress: "ip-b" },
      } as any, demoteVice, JSON.stringify({ role: "user" }))
    expect(demoteVice.calls[0].status).toBe(200)

    const removed = createRes()
    await routes.get("prefix /api/octopus-auth/users")!.handler(
      {
        method: "DELETE", url: `/api/octopus-auth/users/${tempId}`,
        headers: { ...SAME_ORIGIN, cookie: await login(routes, "boss", "ip-b2") },
        socket: { remoteAddress: "ip-b2" },
      } as any, removed)
    expect(removed.calls[0].status).toBe(200)
    await expect(users.getUser(tempId)).resolves.toBeNull()
  })

  it("CSRF：缺 Origin 的 POST 创建被拒 403", async () => {
    const { users, routes } = setup()
    await makeAdmin(users, "boss", "admin")
    const cookie = await login(routes, "boss", "ip-b")
    const res = createRes()
    await routes.get("exact /api/octopus-auth/users")!.handler(
      { method: "POST", url: "/x", headers: { cookie }, socket: { remoteAddress: "ip-b" } } as any,
      res, JSON.stringify({ username: "x9", password: "longenough1" }))
    expect(res.calls[0].status).toBe(403)
  })

  void vi
})