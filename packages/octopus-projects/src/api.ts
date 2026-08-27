import { stat, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { isValidProjectName, PROJECT_STATUSES, type ProjectRecord, type ProjectStatus } from "./domain.js"

export const BASE_PATH = "/api/octopus-projects"

const ID_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

function randomProjectId(): string {
  let id = "prj"
  for (let i = 0; i < 4; i++) {
    id += ID_LETTERS[Math.floor(Math.random() * ID_LETTERS.length)]
  }
  return id
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export interface ApiRequest {
  method?: string
  url?: string
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface ApiResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string | Uint8Array): unknown
}

export interface ProjectsTableLike {
  get(id: string): ProjectRecord | undefined
  entries(): IterableIterator<[string, ProjectRecord]>
  put(id: string, value: ProjectRecord): Promise<void>
  delete(id: string): Promise<boolean>
}

export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<{ id: string }>
}

export interface ProjectsApiDeps {
  defaultRoot: string
  projects: ProjectsTableLike
  workspaces: WorkspaceRegistryLike
}

export interface ProjectView extends ProjectRecord { id: string }

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

function parseStatus(value: unknown): ProjectStatus {
  if (typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value)) {
    return value as ProjectStatus
  }
  throw new ApiError(400, "invalid status")
}

function toView(id: string, record: ProjectRecord): ProjectView {
  return { id, ...record }
}

export function createProjectsHandler(deps: ProjectsApiDeps): (req: ApiRequest, res: ApiResponse) => Promise<void> {
  return async function handler(req, res) {
    try {
      let pathname = "/"
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)
      } catch {
        sendJson(res, 400, { error: "bad request path" })
        return
      }
      const method = (req.method ?? "GET").toUpperCase()
      const sub = pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname
      const segs = sub.split("/").filter(Boolean)

      if (method === "GET" && sub === "/config") {
        sendJson(res, 200, { defaultWorkspaceRoot: deps.defaultRoot })
        return
      }

      if (segs[0] !== "projects") {
        sendJson(res, 404, { error: "not found" })
        return
      }

      if (method === "GET" && segs.length === 1) {
        const items = [...deps.projects.entries()]
          .map(([id, record]) => toView(id, record))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        sendJson(res, 200, { items })
        return
      }

      if (method === "POST" && segs.length === 1) {
        const body = await readJsonBody(req)
        const name = typeof body.name === "string" ? body.name.trim() : ""
        if (!isValidProjectName(name)) throw new ApiError(400, "invalid project name")
        const status = body.status === undefined ? "active" : parseStatus(body.status)
        const description = typeof body.description === "string" ? body.description : ""
        const dir = join(deps.defaultRoot, name)
        if (await stat(dir).then(() => true, () => false)) {
          throw new ApiError(409, `workspace path already exists: ${dir}`)
        }
        await mkdir(dir, { recursive: true })
        let workspaceId: string
        try {
          const ws = await deps.workspaces.create(dir, name)
          workspaceId = ws.id
        } catch (error) {
          throw new ApiError(409, `workspace create failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        const existingIds = new Set([...deps.projects.entries()].map(([id]) => id))
        let id = randomProjectId()
        while (existingIds.has(id)) id = randomProjectId()
        const record: ProjectRecord = { name, description, status, workspacePath: dir, workspaceId, createdAt: new Date().toISOString() }
        await deps.projects.put(id, record)
        sendJson(res, 201, { project: toView(id, record) })
        return
      }

      if (segs.length === 2 && method === "PATCH") {
        const id = segs[1]
        const existing = deps.projects.get(id)
        if (!existing) throw new ApiError(404, "project not found")
        const body = await readJsonBody(req)
        const next: ProjectRecord = { ...existing }
        if ("description" in body) {
          if (typeof body.description !== "string") throw new ApiError(400, "description must be a string")
          next.description = body.description
        }
        if ("status" in body) next.status = parseStatus(body.status)
        await deps.projects.put(id, next)
        sendJson(res, 200, { project: toView(id, next) })
        return
      }

      if (segs.length === 2 && method === "DELETE") {
        const removed = await deps.projects.delete(segs[1])
        if (!removed) throw new ApiError(404, "project not found")
        sendJson(res, 200, { deleted: true })
        return
      }

      if (segs.length <= 2) {
        sendJson(res, 405, { error: "method not allowed" })
        return
      }
      sendJson(res, 404, { error: "not found" })
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, { error: error.message })
        return
      }
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
