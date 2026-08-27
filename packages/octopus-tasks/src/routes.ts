import type { HttpRequest, HttpResponse } from "octopus"
import { generateTaskDrafts } from "./decompose.js"
import { TaskStore } from "./store.js"
import {
  PRIORITIES,
  TASK_STATUSES,
  TasksError,
  type Priority,
  type TaskDraft,
  type TaskInput,
  type TaskPatch,
  type TaskStatus,
} from "./types.js"

export const API_PREFIX = "/api/octopus-tasks"
export const TASKS_PATH = API_PREFIX + "/tasks"

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
  const match = pathname.match(new RegExp("^" + TASKS_PATH.replaceAll("/", "\/") + "\/([^/]+)$"))
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    throw new ApiError(400, "bad-request", "malformed task id")
  }
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value)
}

function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value)
}

/** 校验并归一化 body 为对象（多余字段忽略） */
function requireObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "invalid-input", "request body must be a JSON object")
  }
  return body as Record<string, unknown>
}

function requireString(raw: Record<string, unknown>, key: string, label: string): string {
  if (typeof raw[key] !== "string" || !(raw[key] as string).trim()) {
    throw new ApiError(400, "invalid-input", `${label} is required`)
  }
  return raw[key] as string
}

/** batch 任务草稿：仅 title/description/priority/assignee，多余字段忽略 */
function parseDraft(raw: Record<string, unknown>, required: boolean): TaskDraft {
  const hasTitle = typeof raw.title === "string" && (raw.title as string).trim().length > 0
  if (!hasTitle) {
    if (required) throw new ApiError(400, "invalid-input", "title is required")
    return { title: "" }
  }
  const draft: TaskDraft = { title: raw.title as string }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new ApiError(400, "invalid-input", "description must be a string")
    draft.description = raw.description
  }
  if (raw.priority !== undefined) {
    if (!isPriority(raw.priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    draft.priority = raw.priority
  }
  if (raw.assignee !== undefined) {
    if (raw.assignee !== null && typeof raw.assignee !== "string") {
      throw new ApiError(400, "invalid-input", "assignee must be a string or null")
    }
    draft.assignee = (raw.assignee as string | null) ?? ""
  }
  return draft
}

/** 校验并归一化单条创建入参（status 为服务端保留，客户端不可指定） */
export function parseCreateInput(body: unknown): TaskInput {
  const raw = requireObject(body)
  const title = requireString(raw, "title", "title")
  const requirementId = requireString(raw, "requirementId", "requirementId")
  const projectId = requireString(raw, "projectId", "projectId")
  const input: TaskInput = { title, requirementId, projectId }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new ApiError(400, "invalid-input", "description must be a string")
    input.description = raw.description
  }
  if (raw.priority !== undefined) {
    if (!isPriority(raw.priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    input.priority = raw.priority
  }
  if (raw.assignee !== undefined) {
    if (raw.assignee !== null && typeof raw.assignee !== "string") {
      throw new ApiError(400, "invalid-input", "assignee must be a string or null")
    }
    input.assignee = (raw.assignee as string | null) ?? undefined
  }
  return input
}

export function parseBatchInput(body: unknown): {
  requirementId: string
  projectId: string
  tasks: TaskDraft[]
} {
  const raw = requireObject(body)
  const requirementId = requireString(raw, "requirementId", "requirementId")
  const projectId = requireString(raw, "projectId", "projectId")
  if (!Array.isArray(raw.tasks)) {
    throw new ApiError(400, "invalid-input", "tasks is required")
  }
  if (raw.tasks.length === 0) {
    throw new ApiError(400, "invalid-input", "tasks must be a non-empty array")
  }
  const tasks = raw.tasks.map((task) => parseDraft(requireObject(task), true))
  return { requirementId, projectId, tasks }
}

export function parseDecomposeInput(body: unknown): {
  requirementId: string
  title: string
  description?: string
  priority?: Priority
} {
  const raw = requireObject(body)
  const requirementId = requireString(raw, "requirementId", "requirementId")
  const title = requireString(raw, "title", "title")
  const out: { requirementId: string; title: string; description?: string; priority?: Priority } = {
    requirementId,
    title,
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new ApiError(400, "invalid-input", "description must be a string")
    out.description = raw.description
  }
  if (raw.priority !== undefined) {
    if (!isPriority(raw.priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    out.priority = raw.priority
  }
  return out
}

/** 校验并归一化更新入参（assignee 为空白字符串视为清空为 null） */
export function parsePatchInput(body: unknown): TaskPatch {
  const raw = requireObject(body)
  const patch: TaskPatch = {}
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
    if (!isStatus(raw.status)) throw new ApiError(400, "invalid-input", `status must be one of ${TASK_STATUSES.join(", ")}`)
    patch.status = raw.status
  }
  if (raw.assignee !== undefined) {
    if (raw.assignee !== null && typeof raw.assignee !== "string") {
      throw new ApiError(400, "invalid-input", "assignee must be a string or null")
    }
    patch.assignee = typeof raw.assignee === "string" ? raw.assignee.trim() || null : null
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, "invalid-input", "no fields to update")
  }
  return patch
}

/** 列表查询：projectId 必填，status/requirementId/priority 可选过滤 */
function listQuery(req: HttpRequest): {
  projectId: string
  requirementId?: string
  status?: TaskStatus
  priority?: Priority
} {
  const url = new URL(req.url ?? "/", "http://localhost")
  const projectId = url.searchParams.get("projectId")
  if (projectId === null || !projectId.trim()) {
    throw new ApiError(400, "invalid-input", "projectId is required")
  }
  const query: { projectId: string; requirementId?: string; status?: TaskStatus; priority?: Priority } = {
    projectId,
  }
  const requirementId = url.searchParams.get("requirementId")
  if (requirementId !== null) query.requirementId = requirementId
  const status = url.searchParams.get("status")
  if (status !== null) {
    if (!isStatus(status)) throw new ApiError(400, "invalid-input", `status must be one of ${TASK_STATUSES.join(", ")}`)
    query.status = status
  }
  const priority = url.searchParams.get("priority")
  if (priority !== null) {
    if (!isPriority(priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    query.priority = priority
  }
  return query
}

/** 单前缀路由入口：内部按 pathname + method 分发 */
export function createTaskApiHandler(store: TaskStore): RouteHandler {
  return async function handler(req: HttpRequest, res: HttpResponse) {
    try {
      await dispatch(store, req, res)
    } catch (error) {
      if (error instanceof ApiError) {
        fail(res, error.status, error.code, error.message)
      } else if (error instanceof TasksError) {
        const status = error.code === "not-found" ? 404 : error.code === "invalid-transition" ? 422 : 400
        fail(res, status, error.code, error.message)
      } else {
        console.error("[octopus-tasks] internal error", error)
        fail(res, 500, "internal", "internal server error")
      }
    }
  }
}

async function dispatch(store: TaskStore, req: HttpRequest, res: HttpResponse): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase()
  const pathname = pathnameOf(req)

  if (pathname === TASKS_PATH + "/batch") {
    if (method !== "POST") {
      fail(res, 405, "method-not-allowed", `method ${method} not allowed on ${TASKS_PATH}/batch`)
      return
    }
    const input = parseBatchInput(await readJsonBody(req))
    const records = await store.createBatch(input)
    json(res, 201, { ok: true, data: records })
    return
  }

  if (pathname === TASKS_PATH + "/decompose") {
    if (method !== "POST") {
      fail(res, 405, "method-not-allowed", `method ${method} not allowed on ${TASKS_PATH}/decompose`)
      return
    }
    const input = parseDecomposeInput(await readJsonBody(req))
    ok(res, { drafts: generateTaskDrafts(input) })
    return
  }

  if (pathname === TASKS_PATH) {
    if (method === "GET") {
      const { projectId, requirementId, status, priority } = listQuery(req)
      ok(
        res,
        store.list(
          (t) =>
            t.projectId === projectId &&
            (requirementId === undefined || t.requirementId === requirementId) &&
            (status === undefined || t.status === status) &&
            (priority === undefined || t.priority === priority),
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
    fail(res, 405, "method-not-allowed", `method ${method} not allowed on ${TASKS_PATH}`)
    return
  }

  const id = parseId(pathname)
  if (id !== null) {
    if (method === "GET") {
      const record = store.get(id)
      if (!record) throw new TasksError("not-found", `task ${id} not found`)
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
    fail(res, 405, "method-not-allowed", `method ${method} not allowed on task ${id}`)
    return
  }

  fail(res, 404, "not-found", `no route for ${method} ${pathname}`)
}
