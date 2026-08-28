import { ManagerError } from "./manager.js"
import type { AgentStreamEvent, CreateSessionInput, PresetInfo, SessionMeta } from "./types.js"

export const BASE_PATH = "/api/octopus-agent"

export interface ApiRequest {
  method?: string
  url?: string
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface ApiResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  write(chunk: string): unknown
  end(body?: string): unknown
  on?(event: string, listener: (...args: unknown[]) => void): unknown
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export interface IndexLike {
  list(startIdx?: number): AgentStreamEvent[]
  lastIdx: number
}

export interface ApiDeps {
  listPresets(): Promise<{ items: PresetInfo[]; defaultId: string | null }>
  manager: {
    create(input: CreateSessionInput): Promise<SessionMeta>
    list(): Promise<SessionMeta[]>
    getIndex(id: string, opts?: { allowResume?: boolean }): Promise<IndexLike>
    getStatus(id: string): { live: boolean; status?: "idle" | "running"; pendingApprovalId?: string }
    send(id: string, text: string, answerQuestionId?: string): Promise<void>
    cancel(id: string): Promise<void>
    dispose(id: string): Promise<void>
    answerApproval(id: string, approvalId: string, decision: "allow" | "deny"): Promise<void>
  }
}

function sendJson(res: ApiResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

function readRawBody(req: ApiRequest): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    let data = ""
    req.on("data", (chunk) => { data += typeof chunk === "string" ? chunk : String(chunk ?? "") })
    req.on("end", () => resolveP(data))
    req.on("error", (error) => rejectP(error instanceof Error ? error : new Error(String(error))))
  })
}

async function readJsonBody(req: ApiRequest): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req)
  try {
    const parsed: unknown = JSON.parse(raw.length > 0 ? raw : "{}")
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object")
    return parsed as Record<string, unknown>
  } catch {
    throw new ApiError(400, "malformed json body")
  }
}

function segsOf(url: string | undefined, base: string): string[] | null {
  try {
    const pathname = decodeURIComponent(new URL(url ?? "/", "http://localhost").pathname)
    const sub = pathname.startsWith(base) ? pathname.slice(base.length) : pathname
    return sub.split("/").filter(Boolean)
  } catch {
    return null
  }
}

function afterParam(url: string | undefined): number {
  try {
    const n = Number(new URL(url ?? "/", "http://localhost").searchParams.get("after") ?? 0)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

function isAbsolutePath(cwd: string): boolean {
  return cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(cwd)
}

function toError(error: unknown): { status: number; message: string } {
  if (error instanceof ApiError) return { status: error.status, message: error.message }
  if (error instanceof ManagerError) {
    const statuses: Record<ManagerError["code"], number> = {
      SESSION_NOT_FOUND: 404,
      APPROVAL_NOT_FOUND: 404,
      AGENT_LOOP_UNAVAILABLE: 503,
      SESSION_EXISTS: 409,
    }
    return { status: statuses[error.code] ?? 500, message: error.message }
  }
  return { status: 500, message: error instanceof Error ? error.message : String(error) }
}

export function createAgentApi(deps: ApiDeps): (req: ApiRequest, res: ApiResponse) => Promise<void> {
  const manager = deps.manager
  return async function handler(req, res) {
    try {
      const method = (req.method ?? "GET").toUpperCase()
      const segs = segsOf(req.url, BASE_PATH)
      if (!segs) {
        sendJson(res, 400, { error: "bad request path" })
        return
      }
      const [first, second, third, fourth] = segs

      if (method === "GET" && segs.length === 0) {
        sendJson(res, 200, { ok: true })
        return
      }
      if (method === "GET" && first === "up") {
        sendJson(res, 200, { ok: true })
        return
      }
      if (method === "GET" && first === "presets" && segs.length === 1) {
        sendJson(res, 200, await deps.listPresets())
        return
      }
      if (first !== "sessions") {
        sendJson(res, 404, { error: "not found" })
        return
      }

      if (method === "POST" && !second) {
        const body = await readJsonBody(req)
        const cwd = typeof body.cwd === "string" ? body.cwd : undefined
        if (cwd !== undefined && !isAbsolutePath(cwd)) throw new ApiError(400, "cwd must be an absolute path")
        const session = await manager.create({
          cwd,
          agentPreset: typeof body.agentPreset === "string" ? body.agentPreset : undefined,
          provider: typeof body.provider === "string" ? body.provider : undefined,
          model: typeof body.model === "string" ? body.model : undefined,
        })
        sendJson(res, 201, { session })
        return
      }
      if (method === "GET" && !second) {
        sendJson(res, 200, { items: await manager.list() })
        return
      }
      if (method === "DELETE" && second && !third) {
        await manager.dispose(second)
        sendJson(res, 200, { ok: true })
        return
      }
      if (second && third === "history" && method === "GET") {
        const index = await manager.getIndex(second, { allowResume: true })
        const found = (await manager.list()).find((item) => item.id === second)
        const session: SessionMeta = {
          id: second,
          createdAt: found?.createdAt ?? new Date(0).toISOString(),
          cwd: found?.cwd ?? null,
          title: found?.title ?? null,
          live: true,
        }
        sendJson(res, 200, { session, events: index.list(0), lastIdx: index.lastIdx })
        return
      }
      if (second && third === "status" && method === "GET") {
        sendJson(res, 200, manager.getStatus(second))
        return
      }
      if (second && third === "messages" && method === "POST") {
        const body = await readJsonBody(req)
        const text = typeof body.text === "string" ? body.text : ""
        if (text.trim().length === 0) throw new ApiError(400, "text must be a non-empty string")
        const answerQuestionId = typeof body.answerQuestionId === "string" ? body.answerQuestionId : undefined
        await manager.send(second, text, answerQuestionId)
        sendJson(res, 200, { ok: true })
        return
      }
      if (second && third === "cancel" && method === "POST") {
        await manager.cancel(second)
        sendJson(res, 200, { ok: true })
        return
      }
      if (second && third === "approvals" && fourth && method === "POST") {
        const body = await readJsonBody(req)
        const decision = body.decision
        if (decision !== "allow" && decision !== "deny") throw new ApiError(400, "decision must be allow or deny")
        await manager.answerApproval(second, fourth, decision)
        sendJson(res, 200, { ok: true })
        return
      }
      if (second && third === "events" && method === "GET") {
        const after = afterParam(req.url)
        const index = await manager.getIndex(second, { allowResume: true })
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        })
        let last = after - 1
        for (const event of index.list(after)) {
          res.write(`id: ${event.idx}\ndata: ${JSON.stringify(event)}\n\n`)
          last = event.idx
        }
        let closed = false
        const timer = setInterval(() => {
          if (closed) return
          for (const event of index.list(last + 1)) {
            res.write(`id: ${event.idx}\ndata: ${JSON.stringify(event)}\n\n`)
            last = event.idx
          }
        }, 250)
        req.on("close", () => {
          closed = true
          clearInterval(timer)
        })
        return
      }

      sendJson(res, 404, { error: "not found" })
    } catch (error) {
      const { status, message } = toError(error)
      sendJson(res, status, { error: message })
    }
  }
}
