import type { Context } from "@deepseek-ai/cordis"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { UserRecord, UsersService } from "octopus-users"
import { UsersError } from "octopus-users"
import { AuthConfigSchema, resolveAuthConfig, type AuthResolvedConfig } from "./config.js"
import { httpError, isHttpError } from "./errors.js"
import { parseBody } from "./body.js"
import { hashPassword } from "./hash.js"
import { createRateLimiter } from "./rate-limit.js"
import {
  assertSameOrigin, buildClearCookie, parseCookies, sessionCookieName,
} from "./request.js"
import { createAuthService, SINGLE_USER_SESSION, type AuthService, type AuthSession } from "./session.js"
import { renderLoginPage } from "./login-page.js"

export { isHttpError, httpError } from "./errors.js"
export { resolveAuthConfig, AuthConfigSchema } from "./config.js"
export type { AuthResolvedConfig } from "./config.js"
export { createAuthService, SINGLE_USER_SESSION } from "./session.js"
export type { AuthService, AuthSession, AuthUser } from "./session.js"
export { createUsersService } from "octopus-users"

declare module "@deepseek-ai/cordis" {
  interface Context {
    auth: AuthService
  }
}

export const name = "octopus-auth"
export const inject = ["webServer", "users"] as const
export const Config = AuthConfigSchema

type Json = Record<string, unknown>

type Handler = (req: IncomingMessage, res: ServerResponse, bodyText?: string) => Promise<void>

interface WebServerLike {
  register(route: { kind: "exact" | "prefix"; path: string; handler: Handler }): () => void
}

function sendJson(res: ServerResponse, status: number, body: Json, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...extraHeaders })
  res.end(JSON.stringify(body))
}

function handleError(res: ServerResponse, error: unknown) {
  if (isHttpError(error)) {
    sendJson(res, error.statusCode, { error: error.code, message: error.message })
    return
  }
  if (error instanceof UsersError) {
    const status = error.code === "conflict" ? 409 : error.code === "not-found" ? 404 : 400
    sendJson(res, status, { error: error.code, message: error.message })
    return
  }
  throw error
}

function requireField(body: unknown, field: string): string {
  const value = (body as Json)?.[field]
  if (typeof value !== "string" || value.length === 0) throw httpError(400, "bad-request", `缺少字段 ${field}`)
  return value
}

function assertPasswordStrength(password: string) {
  if (password.length < 8) throw httpError(400, "weak-password", "密码至少 8 位")
}

function sanitizeUser(u: UserRecord) {
  return { id: u.id, username: u.username, role: u.role, disabled: u.disabled, createdAt: u.createdAt }
}

export function apply(ctx: Context, partialConfig: Partial<AuthResolvedConfig> = {}) {
  const config = resolveAuthConfig(partialConfig)
  const users = (ctx as unknown as { users: UsersService }).users
  const authService = createAuthService({
    users, config,
    rateLimiter: createRateLimiter({ windowMs: 15 * 60_000, maxFailures: 5 }),
  })
  ctx.provide("auth", authService)

  const webServer = (ctx as unknown as { webServer: WebServerLike }).webServer
  const secure = config.secureCookie
  const cookieName = sessionCookieName(secure)
  const USERS_PREFIX = "/api/octopus-auth/users"

  function assertNotSelf(session: AuthSession, targetId: string) {
    if (session.user.id === targetId) throw httpError(400, "self-operation", "不能对自己执行该操作")
  }

  async function assertNotLastAdmin(targetId: string, demoteOrDisable: boolean) {
    const target = await users.getUser(targetId)
    if (!target || target.role !== "admin" || target.disabled) return
    const activeAdmins = await users.countActiveAdmins()
    if (activeAdmins <= 1 && demoteOrDisable) {
      throw httpError(400, "last-admin", "不能移除最后一个可用管理员")
    }
  }

  ctx.effect(() => {
    const disposers = [
      webServer.register({
        kind: "exact",
        path: "/login",
        handler: async (_req, res) => {
          let needsSetup = false
          if (config.mode === "multi-user") needsSetup = (await users.listUsers()).length === 0
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
          res.end(renderLoginPage({ needsSetup }))
        },
      }),
      webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/login",
        handler: async (req, res, bodyText) => {
          try {
            assertSameOrigin(req)
            const body = await parseBody(req, bodyText)
            const { setCookie } = await authService.login(
              requireField(body, "username"), requireField(body, "password"), req,
            )
            sendJson(res, 200, { ok: true }, { "set-cookie": setCookie })
          } catch (error) { handleError(res, error) }
        },
      }),
      webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/logout",
        handler: async (req, res) => {
          try {
            await authService.requireAuth(req)
            const { setCookie } = await authService.logout(req)
            sendJson(res, 200, { ok: true }, { "set-cookie": setCookie })
          } catch (error) { handleError(res, error) }
        },
      }),
      webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/me",
        handler: async (req, res) => {
          try {
            const session = await authService.requireAuth(req)
            sendJson(res, 200, {
              user: session.user,
              canLogout: config.mode !== "single-user",
            })
          } catch (error) { handleError(res, error) }
        },
      }),
      webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/verify",
        handler: async (req, res) => {
          const session = await authService.resolveRequest(req)
          res.writeHead(session ? 204 : 401)
          res.end()
        },
      }),
      webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/users",
        handler: async (req, res, bodyText) => {
          try {
            await authService.requireAdmin(req)
            assertSameOrigin(req)
            if ((req.method ?? "GET").toUpperCase() === "GET") {
              sendJson(res, 200, { users: (await users.listUsers()).map(sanitizeUser) })
              return
            }
            const body = (await parseBody(req, bodyText)) as Json
            const rawPassword = requireField(body, "password")
            assertPasswordStrength(rawPassword)
            const created = await users.createUser({
              username: requireField(body, "username"),
              role: body.role === "admin" ? "admin" : "user",
              passwordHash: await hashPassword(rawPassword),
            })
            sendJson(res, 201, { user: sanitizeUser(created) })
          } catch (error) { handleError(res, error) }
        },
      }),
      webServer.register({
        kind: "prefix",
        path: USERS_PREFIX,
        handler: async (req, res, bodyText) => {
          try {
            const session = await authService.requireAdmin(req)
            assertSameOrigin(req)
            const id = decodeURIComponent((req.url ?? "").slice(USERS_PREFIX.length).replace(/^\//, "").split("?")[0])
            if (!id) throw httpError(404, "not-found", "缺少用户 id")
            const method = (req.method ?? "GET").toUpperCase()

            if (method === "DELETE") {
              assertNotSelf(session, id)
              await assertNotLastAdmin(id, true)
              await users.deleteUser(id)
              sendJson(res, 200, { ok: true })
              return
            }
            if (method === "PATCH") {
              const body = (await parseBody(req, bodyText)) as Json
              const patch: Record<string, unknown> = {}
              if (typeof body.password === "string") {
                assertPasswordStrength(body.password)
                patch.passwordHash = await hashPassword(body.password)
              }
              if (typeof body.role === "string") {
                if (body.role !== "admin" && body.role !== "user") throw httpError(400, "bad-request", "role 非法")
                patch.role = body.role
              }
              if (typeof body.disabled === "boolean") patch.disabled = body.disabled
              if (Object.keys(patch).length === 0) throw httpError(400, "bad-request", "无可应用字段")

              const willDemote = patch.role === "user"
              const willDisable = patch.disabled === true
              if (willDisable && session.user.id === id) throw httpError(400, "self-operation", "不能禁用自己")
              if (willDemote || willDisable) {
                await assertNotLastAdmin(id, true)
              }
              const updated = await users.updateUser(id, patch as Partial<UserRecord>)
              sendJson(res, 200, { user: sanitizeUser(updated) })
              return
            }
            throw httpError(405, "method-not-allowed", "仅支持 PATCH/DELETE")
          } catch (error) { handleError(res, error) }
        },
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  void bootstrapAdminAccount(users, config, ctx)
}

async function bootstrapAdminAccount(
  users: UsersService,
  config: AuthResolvedConfig,
  ctx: Context,
): Promise<void> {
  if (config.mode !== "multi-user") return
  const logger = (ctx as unknown as { logger?: { info?(msg: string): void; warn?(msg: string): void } }).logger
  try {
    if ((await users.listUsers()).length > 0) return
    const boot = config.bootstrapAdmin
    if (!boot) {
      logger?.warn?.("[octopus-auth] 用户表为空且未配置 bootstrapAdmin：请在 profile 配置中设置后重启")
      return
    }
    await users.createUser({
      username: boot.username,
      passwordHash: await hashPassword(boot.password),
      role: "admin",
    })
    logger?.info?.("[octopus-auth] 已创建初始管理员账户")
  } catch (error) {
    logger?.warn?.(`[octopus-auth] 初始化管理员失败: ${String(error)}`)
  }
}

export default { name, inject, Config, apply }
