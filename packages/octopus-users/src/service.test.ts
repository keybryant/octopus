import { beforeEach, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { createFakeBackend } from "./unit.test.js"
import { createUsersService, type UsersService } from "./service.js"
import type { SessionRecord, UserRecord } from "./types.js"

function seedUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: randomUUID(), username: "alice", passwordHash: "scrypt$16384$8$1$aa$bb",
    role: "user", disabled: false, createdAt: Date.now(), ...overrides,
  }
}

describe("createUsersService", () => {
  let service: UsersService
  beforeEach(() => { service = createUsersService(createFakeBackend()) })

  it("创建并读取用户，findByUsername 大小写不敏感", async () => {
    const created = await service.createUser({ username: "Alice", passwordHash: "h1", role: "admin" })
    expect(created).toMatchObject({ username: "Alice", role: "admin", disabled: false })
    await expect(service.getUser(created.id)).resolves.toMatchObject({ id: created.id })
    await expect(service.findByUsername("alice")).resolves.toMatchObject({ id: created.id })
  })

  it("拒绝非法用户名（空/含空白）", async () => {
    await expect(service.createUser({ username: "  ", passwordHash: "h", role: "user" })).rejects.toMatchObject({ code: "invalid" })
    await expect(service.createUser({ username: "a b", passwordHash: "h", role: "user" })).rejects.toMatchObject({ code: "invalid" })
  })

  it("重复用户名返回 conflict（大小写不敏感）", async () => {
    await service.createUser({ username: "alice", passwordHash: "h", role: "user" })
    await expect(service.createUser({ username: "ALICE", passwordHash: "h", role: "user" })).rejects.toMatchObject({ code: "conflict" })
  })

  it("updateUser 更新字段；目标不存在抛 not-found", async () => {
    const u = await service.createUser({ username: "bob", passwordHash: "h", role: "user" })
    const updated = await service.updateUser(u.id, { role: "admin", passwordHash: "h2" })
    expect(updated).toMatchObject({ role: "admin", passwordHash: "h2" })
    await expect(service.updateUser("nope", { disabled: true })).rejects.toMatchObject({ code: "not-found" })
    await expect(service.deleteUser("nope")).rejects.toMatchObject({ code: "not-found" })
  })

  it("deleteUser 级联删除会话", async () => {
    const u = await service.createUser({ username: "carol", passwordHash: "h", role: "user" })
    await service.putSession({ id: "s1", userId: u.id, createdAt: 1, expiresAt: Date.now() + 60_000 })
    await service.deleteUser(u.id)
    await expect(service.getUser(u.id)).resolves.toBeNull()
    await expect(service.getSession("s1")).resolves.toBeNull()
  })

  it("countActiveAdmins 不计 disabled", async () => {
    const a = await service.createUser({ username: "root", passwordHash: "h", role: "admin" })
    expect(await service.countActiveAdmins()).toBe(1)
    await service.updateUser(a.id, { disabled: true })
    expect(await service.countActiveAdmins()).toBe(0)
  })

  it("listUsers 按 createdAt 升序返回全部", async () => {
    const u1 = await service.createUser({ username: "u1", passwordHash: "h", role: "user" })
    const u2 = await service.createUser({ username: "u2", passwordHash: "h", role: "admin" })
    expect((await service.listUsers()).map((x) => x.id)).toEqual([u1.id, u2.id])
  })

  it("put/get/delete 会话；读过期会话惰性删除", async () => {
    await service.putSession({ id: "live", userId: "u1", createdAt: 1, expiresAt: Date.now() + 60_000 })
    await expect(service.getSession("live")).resolves.toBeTruthy()
    await service.putSession({ id: "stale", userId: "u1", createdAt: 1, expiresAt: 1 })
    await expect(service.getSession("stale")).resolves.toBeNull()
    await expect(service.getSession("stale")).resolves.toBeNull()
    await service.deleteSession("live")
    await expect(service.getSession("live")).resolves.toBeNull()
  })

  it("每用户最多 20 个会话，超出逐出最旧", async () => {
    const base = Date.now()
    for (let i = 0; i <= 20; i++) {
      await service.putSession({ id: `s${i}`, userId: "u1", createdAt: base + i, expiresAt: base + 999_999 })
    }
    await expect(service.getSession("s0")).resolves.toBeNull()
    await expect(service.getSession("s1")).resolves.toBeNull()
    await expect(service.getSession("s20")).resolves.toMatchObject({ id: "s20" })
  })

  it("deleteExpiredSessions / deleteUserSessions 正确计数", async () => {
    const now = Date.now()
    await service.putSession({ id: "live", userId: "a", createdAt: 1, expiresAt: now + 1000 })
    await service.putSession({ id: "dead", userId: "a", createdAt: 1, expiresAt: now - 1000 })
    expect(await service.deleteExpiredSessions(now)).toBe(1)
    await service.putSession({ id: "b", userId: "b", createdAt: 1, expiresAt: now + 1000 })
    expect(await service.deleteUserSessions("a")).toBe(1)
    await expect(service.getSession("b")).resolves.toBeTruthy()
  })

  it("并发写经写链串行化且全部生效", async () => {
    const u = await service.createUser({ username: "dana", passwordHash: "h", role: "user" })
    await Promise.all([
      service.updateUser(u.id, { role: "admin" }),
      service.updateUser(u.id, { passwordHash: "h9" }),
    ])
    await expect(service.getUser(u.id)).resolves.toMatchObject({ role: "admin", passwordHash: "h9" })
  })

  it("close 后调用抛 closed", async () => {
    await service.close()
    await expect(service.listUsers()).rejects.toMatchObject({ code: "closed" })
  })

  it("seedUser 辅助可用", () => {
    expect(seedUser().username).toBe("alice")
    void ({} as SessionRecord)
  })
})
