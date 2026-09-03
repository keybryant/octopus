import type { TaskDraft, TaskPatch, TaskRecord, TaskStatus } from "./types"

const BASE = "/api/octopus-tasks/tasks"

interface ApiOk<T> {
  ok: true
  data: T
}

/** 当前项目编码：宿主 shell 通过 window.__octopusProjectId 注入；回退 URL query */
export function currentProjectId(): string {
  const injected = (window as { __octopusProjectId?: string }).__octopusProjectId
  if (injected) return injected
  return new URLSearchParams(window.location.search).get("projectId") ?? ""
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { "content-type": "application/json" },
      ...init,
    })
  } catch {
    throw new Error("无法连接服务，请确认 octopus-tasks 插件已加载")
  }
  const body = (await res.json().catch(() => null)) as ApiOk<T> | { ok: false; error: { code: string; message: string } } | null
  if (!res.ok || !body || body.ok !== true) {
    const message = body && body.ok === false ? body.error.message : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body.data
}

export async function listTasks(params?: {
  projectId?: string
  status?: TaskStatus
  requirementId?: string
}): Promise<TaskRecord[]> {
  const qs = new URLSearchParams()
  const projectId = params?.projectId ?? currentProjectId()
  if (projectId) qs.set("projectId", projectId)
  if (params?.status) qs.set("status", params.status)
  if (params?.requirementId) qs.set("requirementId", params.requirementId)
  const query = qs.size > 0 ? `?${qs.toString()}` : ""
  return request<TaskRecord[]>(BASE + query)
}

export async function createTask(input: {
  title: string
  requirementId: string
  projectId?: string
  description?: string
  agent?: string
}): Promise<TaskRecord> {
  return request<TaskRecord>(BASE, {
    method: "POST",
    body: JSON.stringify({ ...input, projectId: input.projectId ?? currentProjectId() }),
  })
}

export async function createTaskBatch(input: {
  requirementId: string
  projectId?: string
  tasks: TaskDraft[]
}): Promise<TaskRecord[]> {
  return request<TaskRecord[]>(BASE + "/batch", {
    method: "POST",
    body: JSON.stringify({ requirementId: input.requirementId, projectId: input.projectId ?? currentProjectId(), tasks: input.tasks }),
  })
}

export async function decomposeTasks(input: {
  requirementId: string
  title: string
  description?: string
}): Promise<TaskDraft[]> {
  const data = await request<{ drafts: TaskDraft[] }>(BASE + "/decompose", {
    method: "POST",
    body: JSON.stringify(input),
  })
  return data.drafts
}

export async function updateTask(id: string, patch: TaskPatch): Promise<TaskRecord> {
  return request<TaskRecord>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function removeTask(id: string): Promise<boolean> {
  return request<boolean>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" })
}
