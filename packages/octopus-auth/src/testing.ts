import type { SessionRecord, UserRecord, UsersService } from "octopus-users"

function codeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(`[octopus-users] ${message}`), { code })
}

export function createFakeUsers(seed: UserRecord[] = []): UsersService & {
  _users: Map<string, UserRecord>
  _sessions: Map<string, SessionRecord>
} {
  const users = new Map(seed.map((u) => [u.id, u]))
  const sessions = new Map<string, SessionRecord>()
  return {
    _users: users,
    _sessions: sessions,

    async findByUsername(username) {
      const wanted = username.trim().toLowerCase()
      return [...users.values()].find((u) => u.username.toLowerCase() === wanted) ?? null
    },
    async getUser(id) { return users.get(id) ?? null },
    async listUsers() { return [...users.values()].sort((a, b) => a.createdAt - b.createdAt) },

    async createUser(input) {
      const trimmed = input.username.trim()
      if (!trimmed || /\s/.test(trimmed)) throw codeError("invalid", "用户名非法")
      const dup = [...users.values()].some((u) => u.username.toLowerCase() === trimmed.toLowerCase())
      if (dup) throw codeError("conflict", "用户名已存在")
      const rec: UserRecord = {
        id: crypto.randomUUID(), username: trimmed, passwordHash: input.passwordHash,
        role: input.role, disabled: false, createdAt: Date.now(),
      }
      users.set(rec.id, rec)
      return rec
    },

    async updateUser(id, patch) {
      const existing = users.get(id)
      if (!existing) throw codeError("not-found", "用户不存在")
      const updated = { ...existing, ...patch }
      users.set(id, updated)
      return updated
    },

    async deleteUser(id) {
      if (!users.has(id)) throw codeError("not-found", "用户不存在")
      users.delete(id)
      for (const [k, s] of sessions) if (s.userId === id) sessions.delete(k)
    },

    async countActiveAdmins() {
      return [...users.values()].filter((u) => u.role === "admin" && !u.disabled).length
    },

    async getSession(id) {
      const s = sessions.get(id)
      if (!s) return null
      if (s.expiresAt <= Date.now()) { sessions.delete(id); return null }
      return s
    },
    async putSession(rec) { sessions.set(rec.id, rec) },
    async deleteSession(id) { sessions.delete(id) },

    async deleteExpiredSessions(now) {
      let n = 0
      for (const [k, s] of sessions) if (s.expiresAt <= now) { sessions.delete(k); n += 1 }
      return n
    },
    async deleteUserSessions(userId) {
      let n = 0
      for (const [k, s] of sessions) if (s.userId === userId) { sessions.delete(k); n += 1 }
      return n
    },

    async close() {},
  }
}

export function createRes() {
  const calls: { status: number; headers: Record<string, string>; body: string }[] = []
  return {
    calls,
    writeHead(status: number, headers: Record<string, string> = {}) {
      calls.push({ status, headers, body: "" })
    },
    end(body?: string | Uint8Array) {
      calls[calls.length - 1].body += String(body ?? "")
    },
  }
}
