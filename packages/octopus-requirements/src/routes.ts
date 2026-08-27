import type { HttpRequest, HttpResponse } from "octopus"
import type { RequirementStore } from "./store.js"
import {
  PRIORITIES,
  REQUIREMENT_STATUSES,
  RequirementsError,
  type Priority,
  type RequirementInput,
  type RequirementPatch,
  type RequirementStatus,
} from "./types.js"

export const API_PREFIX = "/api/octopus-requirements"
export const REQUIREMENTS_PATH = API_PREFIX + "/requirements"

/** 路由处理器：参数化路径由内部匹配，method 自行分发 */
export type RouteHandler = (req: HttpRequest, res: HttpResponse) => Promise<void>

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/** 请求体大小上限：超过直接 413，防止整包读入内存 */
export const MAX_BODY_SIZE = 256 * 1024

/** 读取请求体并解析 JSON；空 body 返回 undefined；非法 JSON 抛 400；超限抛 413 */
export async function readJsonBody(req: HttpRequest): Promise<unknown> {
  const source = req as unknown as AsyncIterable<Buffer | string>
  if (typeof source[Symbol.asyncIterator] !== "function") {
    throw new ApiError(400, "bad-request", "request body is not a readable stream")
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BODY_SIZE) {
      throw new ApiError(413, "payload-too-large", `request body exceeds ${MAX_BODY_SIZE} bytes`)
    }
    chunks.push(buf)
  }
  if (chunks.length === 0) return undefined
  const raw = Buffer.concat(chunks).toString("utf8")
  try {
    return JSON.parse(raw)
  } catch {
    throw new ApiError(400, "invalid-json", "request body is not valid JSON")
  }
}

function json(res: HttpResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

function ok(res: HttpResponse, data: unknown): void {
  json(res, 200, { ok: true, data })
}

function fail(res: HttpResponse, status: number, code: string, message: string): void {
  json(res, status, { ok: false, error: { code, message } })
}

function pathnameOf(req: HttpRequest): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname
  } catch {
    throw new ApiError(400, "bad-request", "malformed request url")
  }
}

function parseId(pathname: string): string | null {
  const match = pathname.match(new RegExp("^" + REQUIREMENTS_PATH.replaceAll("/", "\/") + "\/([^/]+)$"))
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    throw new ApiError(400, "bad-request", "malformed requirement id")
  }
}

function isStatus(value: unknown): value is RequirementStatus {
  return typeof value === "string" && (REQUIREMENT_STATUSES as readonly string[]).includes(value)
}

function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value)
}

/** 校验并归一化创建入参（多余字段忽略） */
export function parseCreateInput(body: unknown): RequirementInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "invalid-input", "request body must be a JSON object")
  }
  const raw = body as Record<string, unknown>
  if (typeof raw.title !== "string") {
    throw new ApiError(400, "invalid-input", "title is required")
  }
  if (typeof raw.projectId !== "string" || !raw.projectId.trim()) {
    throw new ApiError(400, "invalid-input", "projectId is required")
  }
  const input: RequirementInput = { title: raw.title, projectId: raw.projectId }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new ApiError(400, "invalid-input", "description must be a string")
    input.description = raw.description
  }
  if (raw.priority !== undefined) {
    if (!isPriority(raw.priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    input.priority = raw.priority
  }
  // source 为服务端保留字段（chat 工具后续创建时使用），客户端不可指定
  return input
}

/** 校验并归一化更新入参 */
export function parsePatchInput(body: unknown): RequirementPatch {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "invalid-input", "request body must be a JSON object")
  }
  const raw = body as Record<string, unknown>
  const patch: RequirementPatch = {}
  if (raw.title !== undefined) {
    if (typeof raw.title !== "string" || !raw.title.trim()) {
      throw new ApiError(400, "invalid-input", "title is required")
    }
    patch.title = raw.title
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new ApiError(400, "invalid-input", "description must be a string")
    patch.description = raw.description
  }
  if (raw.priority !== undefined) {
    if (!isPriority(raw.priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    patch.priority = raw.priority
  }
  if (raw.status !== undefined) {
    if (!isStatus(raw.status)) throw new ApiError(400, "invalid-input", `status must be one of ${REQUIREMENT_STATUSES.join(", ")}`)
    patch.status = raw.status
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, "invalid-input", "no fields to update")
  }
  return patch
}

/** 列表查询：projectId 必填（需求只允许查询归属项目内的记录） */
function listQuery(req: HttpRequest): { projectId: string; status?: RequirementStatus; priority?: Priority } {
  const url = new URL(req.url ?? "/", "http://localhost")
  const status = url.searchParams.get("status")
  const priority = url.searchParams.get("priority")
  const projectId = url.searchParams.get("projectId")
  if (projectId === null || !projectId.trim()) {
    throw new ApiError(400, "invalid-input", "projectId is required")
  }
  const query: { projectId: string; status?: RequirementStatus; priority?: Priority } = { projectId }
  if (status !== null) {
    if (!isStatus(status)) throw new ApiError(400, "invalid-input", `status must be one of ${REQUIREMENT_STATUSES.join(", ")}`)
    query.status = status
  }
  if (priority !== null) {
    if (!isPriority(priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    query.priority = priority
  }
  return query
}

/** 单前缀路由入口：内部按 pathname + method 分发 */
export function createRequirementApiHandler(store: RequirementStore): RouteHandler {
  return async function handler(req: HttpRequest, res: HttpResponse) {
    try {
      await dispatch(store, req, res)
    } catch (error) {
      if (error instanceof ApiError) {
        fail(res, error.status, error.code, error.message)
      } else if (error instanceof RequirementsError) {
        const status = error.code === "not-found" ? 404 : error.code === "invalid-transition" ? 422 : 400
        fail(res, status, error.code, error.message)
      } else {
        console.error("[octopus-requirements] internal error", error)
        fail(res, 500, "internal", "internal server error")
      }
    }
  }
}

async function dispatch(store: RequirementStore, req: HttpRequest, res: HttpResponse): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase()
  const pathname = pathnameOf(req)

  if (pathname === REQUIREMENTS_PATH) {
    if (method === "GET") {
      const { projectId, status, priority } = listQuery(req)
      ok(
        res,
        store.list(
          (r) =>
            r.projectId === projectId &&
            (status === undefined || r.status === status) &&
            (priority === undefined || r.priority === priority),
        ),
      )
      return
    }
    if (method === "POST") {
      const input = parseCreateInput(await readJsonBody(req))
      const record = await store.create(input)
      json(res, 201, { ok: true, data: record })
      return
    }
    fail(res, 405, "method-not-allowed", `method ${method} not allowed on ${REQUIREMENTS_PATH}`)
    return
  }

  const id = parseId(pathname)
  if (id !== null) {
    if (method === "GET") {
      const record = store.get(id)
      if (!record) throw new RequirementsError("not-found", `requirement ${id} not found`)
      ok(res, record)
      return
    }
    if (method === "PATCH") {
      const patch = parsePatchInput(await readJsonBody(req))
      const record = await store.update(id, patch)
      ok(res, record)
      return
    }
    if (method === "DELETE") {
      const removed = await store.remove(id)
      ok(res, removed)
      return
    }
    fail(res, 405, "method-not-allowed", `method ${method} not allowed on requirement ${id}`)
    return
  }

  fail(res, 404, "not-found", `no route for ${method} ${pathname}`)
}
