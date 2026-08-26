import { httpError } from "./errors.js"

export interface RequestLike {
  method?: string
  url?: string
  headers?: { cookie?: string; origin?: string; host?: string; "x-forwarded-for"?: string }
  socket?: { remoteAddress?: string }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=")
    if (idx <= 0) continue
    const key = pair.slice(0, idx).trim()
    try {
      out[key] = decodeURIComponent(pair.slice(idx + 1).trim())
    } catch {
      out[key] = pair.slice(idx + 1).trim()
    }
  }
  return out
}

export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-octopus_session" : "octopus_session"
}

export function buildSetCookie(name: string, id: string, maxAgeSec: number, secure: boolean): string {
  const parts = [`${name}=${id}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`]
  if (secure) parts.push("Secure")
  return parts.join("; ")
}

export function buildClearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function bucketKeyOf(req: RequestLike, trustProxy: boolean): string {
  const xff = req.headers?.["x-forwarded-for"]
  if (trustProxy && typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim()
  }
  return req.socket?.remoteAddress ?? "unknown"
}

/** CSRF 第二道防线：变更类请求必须携带与 Host 一致的 Origin（缺失即拒，严格模式） */
export function assertSameOrigin(req: RequestLike): void {
  const method = (req.method ?? "GET").toUpperCase()
  if (!MUTATING_METHODS.has(method)) return
  const origin = req.headers?.origin
  const host = req.headers?.host
  if (!origin || !host) throw httpError(403, "forbidden", "缺少 Origin 头")
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw httpError(403, "forbidden", "Origin 不合法")
  }
  if (originHost !== host) throw httpError(403, "forbidden", "Origin 与 Host 不匹配")
}
