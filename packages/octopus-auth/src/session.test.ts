import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAuthService, SINGLE_USER_SESSION, type AuthService } from "./session.js"
import { createFakeUsers } from "./testing.js"
import { hashPassword } from "./hash.js"
import type { AuthResolvedConfig } from "./config.js"

const BASE: AuthResolvedConfig = {
  mode: "multi-user", backend: "json", secureCookie: false, sessionTtlDays: 7, trustProxy: false,
}
const PASS_THROUGH_LIMITER = { assertAllowed: () => {}, recordFailure: () => {}, recordSuccess: () => {} }
const LOGIN_REQ = { method: "POST", headers: { origin: "http://x", host: "x" }, socket: { remoteAddress: "t" } }

function cookieIdOf(setCookie: string, name = "octopus_session") {
  return setCookie.split(";")[0]!.slice(name.length + 1)
}

describe("createAuthService（multi-user）", () => {
  let auth: AuthService
  let users: ReturnType<typeof createFakeUsers>

  beforeEach(async () => {
    users = createFakeUsers()
    await users.createUser({ username: "alice", passwordHash: await hashPassword("passw0rd!"), role: "admin" })
    auth = createAuthService({ users, config: BASE, rateLimiter: PASS_THROUGH_LIMITER })
  })

  it("登录签发 cookie 并解析回会话", async () => {
    const { setCookie } = await auth.login("alice", "passw0rd!", LOGIN_REQ)
    expect(setCookie).toContain("octopus_session=")
    const id = cookieIdOf(setCookie)
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/) // randomBytes(32) base64url
    const resolved = await auth.resolveRequest({ headers: { cookie: `octopus_session=${id}` } })
    expect(resolved!.user).toMatchObject({ username: "alice", role: "admin" })
  })

  it("错误密码与不存在用户均抛 401", async () => {
    await expect(auth.login("alice", "wrong-pass!", LOGIN_REQ)).rejects.toMatchObject({ statusCode: 401 })
    await expect(auth.login("ghost", "whatever123", LOGIN_REQ)).rejects.toMatchObject({ statusCode: 401 })
  })

  it("禁用用户即使持有效会话也被拒", async () => {
    const { setCookie } = await auth.login("alice", "passw0rd!", LOGIN_REQ)
    const id = cookieIdOf(setCookie)
    const alice = await users.findByUsername("alice")
    await users.updateUser(alice!.id, { disabled: true })
    await expect(auth.resolveRequest({ headers: { cookie: `octopus_session=${id}` } })).resolves.toBeNull()
  })

  it("过期会话返回 null（fake 的惰性删除路径）", async () => {
    vi.useFakeTimers()
    const { setCookie } = await auth.login("alice", "passw0rd!", LOGIN_REQ)
    const id = cookieIdOf(setCookie)
    vi.setSystemTime(Date.now() + 8 * 24 * 3600_000)
    await expect(auth.resolveRequest({ headers: { cookie: `octopus_session=${id}` } })).resolves.toBeNull()
    vi.useRealTimers()
  })

  it("登出后会话立即失效", async () => {
    const { setCookie } = await auth.login("alice", "passw0rd!", LOGIN_REQ)
    const id = cookieIdOf(setCookie)
    const header = `octopus_session=${id}`
    const { setCookie: cleared } = await auth.logout({ headers: { cookie: header } })
    expect(cleared).toBe("octopus_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
    await expect(auth.resolveRequest({ headers: { cookie: header } })).resolves.toBeNull()
  })

  it("requireAuth 未登录 401；requireAdmin 非 admin 403", async () => {
    await expect(auth.requireAuth({})).rejects.toMatchObject({ statusCode: 401 })
    const plainUsers = createFakeUsers()
    const bob = await plainUsers.createUser({ username: "bob", passwordHash: await hashPassword("passw0rd!"), role: "user" })
    const plainAuth = createAuthService({
      users: plainUsers, config: BASE,
      rateLimiter: {
        assertAllowed: () => {}, recordFailure: () => {}, recordSuccess: () => {},
      },
    })
    const { setCookie } = await plainAuth.login("bob", "passw0rd!", LOGIN_REQ)
    const req = { headers: { cookie: `octopus_session=${cookieIdOf(setCookie)}` } }
    await expect(plainAuth.requireAuth(req)).resolves.toMatchObject({ user: { username: "bob" } })
    await expect(plainAuth.requireAdmin(req)).rejects.toMatchObject({ statusCode: 403 })
    void bob
  })
})

describe("single-user 模式", () => {
  it("一切请求视为虚拟管理员，login 返回 400", async () => {
    const auth = createAuthService({
      users: createFakeUsers(), config: { ...BASE, mode: "single-user" }, rateLimiter: PASS_THROUGH_LIMITER,
    })
    await expect(auth.requireAdmin({})).resolves.toBe(SINGLE_USER_SESSION)
    await expect(auth.resolveRequest({ headers: {} })).resolves.toBe(SINGLE_USER_SESSION)
    await expect(auth.login("a", "b", {})).rejects.toMatchObject({ statusCode: 400 })
  })
})
