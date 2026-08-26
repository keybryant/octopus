import { randomUUID } from "node:crypto"
import type { KvUnit, StorageBackend } from "@deepseek-ai/dsh-storage"
import { openUsersUnit } from "./unit.js"
import { WriteChain } from "./write-chain.js"
import { UsersError, type SessionRecord, type UserRecord } from "./types.js"

const USERNAME_RE = /^\S+$/
const MAX_SESSIONS_PER_USER = 20

export interface UsersService {
  findByUsername(username: string): Promise<UserRecord | null>
  getUser(id: string): Promise<UserRecord | null>
  listUsers(): Promise<UserRecord[]>
  createUser(input: { username: string; passwordHash: string; role: "admin" | "user" }): Promise<UserRecord>
  updateUser(id: string, patch: Partial<Pick<UserRecord, "role" | "disabled" | "passwordHash">>): Promise<UserRecord>
  deleteUser(id: string): Promise<void>
  countActiveAdmins(): Promise<number>
  getSession(id: string): Promise<SessionRecord | null>
  putSession(record: SessionRecord): Promise<void>
  deleteSession(id: string): Promise<void>
  deleteExpiredSessions(now: number): Promise<number>
  deleteUserSessions(userId: string): Promise<number>
  close(): Promise<void>
}

function validateUsername(username: string): string {
  const trimmed = username.trim()
  if (!trimmed || !USERNAME_RE.test(trimmed)) {
    throw new UsersError("invalid", "用户名不能为空且不能含空白字符")
  }
  return trimmed
}

type Snapshot = { tables: Record<string, Record<string, unknown>>; global: unknown }

function usersOf(snapshot: Snapshot) { return snapshot.tables["users"] as Record<string, UserRecord> }
function sessionsOf(snapshot: Snapshot) { return snapshot.tables["sessions"] as Record<string, SessionRecord> }

export function createUsersService(backend: StorageBackend): UsersService {
  let unitPromise: Promise<KvUnit> | null = null
  let closed = false
  const chain = new WriteChain()

  function ensureOpen(): Promise<KvUnit> {
    if (closed) return Promise.reject(new UsersError("closed", "service 已关闭"))
    if (unitPromise === null) unitPromise = openUsersUnit(backend)
    return unitPromise
  }

  const service = {
    async findByUsername(username: string): Promise<UserRecord | null> {
      const wanted = username.trim().toLowerCase()
      const users = usersOf(await (await ensureOpen()).loadAll())
      return Object.values(users).find((u) => u.username.toLowerCase() === wanted) ?? null
    },

    async getUser(id: string): Promise<UserRecord | null> {
      return usersOf(await (await ensureOpen()).loadAll())[id] ?? null
    },

    async listUsers(): Promise<UserRecord[]> {
      return Object.values(usersOf(await (await ensureOpen()).loadAll()))
        .sort((a, b) => a.createdAt - b.createdAt)
    },

    async createUser(input: { username: string; passwordHash: string; role: "admin" | "user" }): Promise<UserRecord> {
      const username = validateUsername(input.username)
      if (!input.passwordHash) throw new UsersError("invalid", "passwordHash 不能为空")
      return chain.run(async () => {
        const unit = await ensureOpen()
        const duplicated = Object.values(usersOf(await unit.loadAll()))
          .some((u) => u.username.toLowerCase() === username.toLowerCase())
        if (duplicated) throw new UsersError("conflict", `用户名已存在: ${username}`)
        const record: UserRecord = {
          id: randomUUID(), username, passwordHash: input.passwordHash,
          role: input.role, disabled: false, createdAt: Date.now(),
        }
        await unit.putRecord("users", record.id, record)
        return record
      })
    },

    updateUser(
      id: string,
      patch: Partial<Pick<UserRecord, "role" | "disabled" | "passwordHash">>,
    ): Promise<UserRecord> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        const existing = usersOf(await unit.loadAll())[id]
        if (!existing) throw new UsersError("not-found", `用户不存在: ${id}`)
        const updated: UserRecord = { ...existing, ...patch }
        await unit.putRecord("users", id, updated)
        return updated
      })
    },

    deleteUser(id: string): Promise<void> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        const snapshot = await unit.loadAll()
        if (!usersOf(snapshot)[id]) throw new UsersError("not-found", `用户不存在: ${id}`)
        await unit.deleteRecord("users", id)
        for (const s of Object.values(sessionsOf(snapshot))) {
          if (s.userId === id) await unit.deleteRecord("sessions", s.id)
        }
      })
    },

    async countActiveAdmins(): Promise<number> {
      const users = usersOf(await (await ensureOpen()).loadAll())
      return Object.values(users).filter((u) => u.role === "admin" && !u.disabled).length
    },

    async getSession(id: string): Promise<SessionRecord | null> {
      const record = sessionsOf(await (await ensureOpen()).loadAll())[id]
      if (!record) return null
      if (record.expiresAt <= Date.now()) {
        await chain.run(async () => {
          await (await ensureOpen()).deleteRecord("sessions", id)
        })
        return null
      }
      return record
    },

    putSession(record: SessionRecord): Promise<void> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        await unit.putRecord("sessions", record.id, record)
        const mine = Object.values(sessionsOf(await unit.loadAll()))
          .filter((s) => s.userId === record.userId)
          .sort((a, b) => a.createdAt - b.createdAt)
        let excess = mine.length - MAX_SESSIONS_PER_USER + 1
        for (const s of mine) {
          if (excess <= 0) break
          await unit.deleteRecord("sessions", s.id)
          excess -= 1
        }
      })
    },

    deleteSession(id: string): Promise<void> {
      return chain.run(async () => {
        await (await ensureOpen()).deleteRecord("sessions", id)
      })
    },

    deleteExpiredSessions(now: number): Promise<number> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        let removed = 0
        for (const s of Object.values(sessionsOf(await unit.loadAll()))) {
          if (s.expiresAt <= now) {
            await unit.deleteRecord("sessions", s.id)
            removed += 1
          }
        }
        return removed
      })
    },

    deleteUserSessions(userId: string): Promise<number> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        let removed = 0
        for (const s of Object.values(sessionsOf(await unit.loadAll()))) {
          if (s.userId === userId) {
            await unit.deleteRecord("sessions", s.id)
            removed += 1
          }
        }
        return removed
      })
    },

    async close(): Promise<void> {
      closed = true
      if (unitPromise !== null) await (await unitPromise).close()
    },
  }

  return service as UsersService
}
