import { randomBytes } from "node:crypto"
import type { UsersService } from "octopus-users"
import { httpError } from "./errors.js"
import { DUMMY_HASH, verifyPassword, hashPassword } from "./hash.js"
import {
  bucketKeyOf, buildClearCookie, buildSetCookie, parseCookies, sessionCookieName,
  type RequestLike,
} from "./request.js"
import type { AuthResolvedConfig } from "./config.js"
import type { RateLimiter } from "./rate-limit.js"

export interface AuthUser {
  id: string
  username: string
  role: "admin" | "user"
}

export interface AuthSession {
  sessionId: string
  user: AuthUser
  expiresAt: number
}

export const SINGLE_USER_SESSION: AuthSession = {
  sessionId: "",
  user: { id: "local", username: "local", role: "admin" },
  expiresAt: Number.POSITIVE_INFINITY,
}

export interface AuthService {
  resolveRequest(req: RequestLike): Promise<AuthSession | null>
  requireAuth(req: RequestLike): Promise<AuthSession>
  requireAdmin(req: RequestLike): Promise<AuthSession>
  login(username: string, password: string, req: RequestLike): Promise<{ setCookie: string }>
  logout(req: RequestLike): Promise<{ setCookie: string }>
  hashPassword(password: string): Promise<string>
  verifyPassword(password: string, stored: string): Promise<boolean>
}

function toAuthUser(u: { id: string; username: string; role: "admin" | "user" }) {
  return { id: u.id, username: u.username, role: u.role }
}

export function createAuthService(options: {
  users: UsersService
  config: AuthResolvedConfig
  rateLimiter: RateLimiter
}): AuthService {
  const { users, config, rateLimiter } = options
  const ttlMs = config.sessionTtlDays * 24 * 3600_000
  const cookieName = sessionCookieName(config.secureCookie)

  async function resolveByCookie(cookieHeader: string | undefined): Promise<AuthSession | null> {
    const id = parseCookies(cookieHeader)[cookieName]
    if (!id) return null
    const record = await users.getSession(id)
    if (!record) return null
    const user = await users.getUser(record.userId)
    if (!user || user.disabled) return null
    return { sessionId: id, user: toAuthUser(user), expiresAt: record.expiresAt }
  }

  return {
    async resolveRequest(req) {
      if (config.mode === "single-user") return SINGLE_USER_SESSION
      return resolveByCookie(req.headers?.cookie)
    },

    async requireAuth(req) {
      const session = await this.resolveRequest(req)
      if (!session) throw httpError(401, "unauthorized", "未登录")
      return session
    },

    async requireAdmin(req) {
      const session = await this.requireAuth(req)
      if (session.user.role !== "admin") throw httpError(403, "forbidden", "需要管理员权限")
      return session
    },

    async login(username, password, req) {
      if (config.mode === "single-user") {
        throw httpError(400, "single-user", "当前为 single-user 模式，无需登录")
      }
      const bucket = bucketKeyOf(req, config.trustProxy)
      rateLimiter.assertAllowed(bucket)
      const user = await users.findByUsername(username)
      let ok = false
      if (user) ok = await verifyPassword(password, user.passwordHash)
      else await verifyPassword(password, await DUMMY_HASH) // 恒定工作量路径
      if (!ok || !user || user.disabled) {
        rateLimiter.recordFailure(bucket)
        throw httpError(401, "unauthorized", "用户名或密码错误")
      }
      rateLimiter.recordSuccess(bucket)
      const now = Date.now()
      const sessionId = randomBytes(32).toString("base64url")
      await users.putSession({ id: sessionId, userId: user.id, createdAt: now, expiresAt: now + ttlMs })
      void users.deleteExpiredSessions(now).catch(() => undefined)
      return { setCookie: buildSetCookie(cookieName, sessionId, Math.floor(ttlMs / 1000), config.secureCookie) }
    },

    async logout(req) {
      const id = parseCookies(req.headers?.cookie)[cookieName]
      if (id) await users.deleteSession(id)
      return { setCookie: buildClearCookie(cookieName) }
    },

    hashPassword,
    verifyPassword,
  }
}
