import type { Priority, RequirementPatch, RequirementRecord, RequirementStatus } from "./types"

const BASE = "/api/octopus-requirements/requirements"

interface ApiOk<T> {
  ok: true
  data: T
}

/** 当前项目编码：宿主 shell 通过 window.__octopusProjectId 注入；低优先级回退 URL query */
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
    throw new Error("无法连接服务，请确认 octopus-requirements 插件已加载")
  }
  const body = (await res.json().catch(() => null)) as ApiOk<T> | { ok: false; error: { code: string; message: string } } | null
  if (!res.ok || !body || body.ok !== true) {
    const message = body && body.ok === false ? body.error.message : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body.data
}

/** 查询只允许落在当前项目下；projectId 有显式传参优先，否则取宿主注入值 */
export async function listRequirements(params?: {
  projectId?: string
  status?: RequirementStatus
  priority?: Priority
}): Promise<RequirementRecord[]> {
  const qs = new URLSearchParams()
  const projectId = params?.projectId ?? currentProjectId()
  if (projectId) qs.set("projectId", projectId)
  if (params?.status) qs.set("status", params.status)
  if (params?.priority) qs.set("priority", params.priority)
  const query = qs.size > 0 ? `?${qs.toString()}` : ""
  return request<RequirementRecord[]>(BASE + query)
}

export async function createRequirement(input: {
  title: string
  projectId?: string
  description?: string
  priority?: Priority
}): Promise<RequirementRecord> {
  return request<RequirementRecord>(BASE, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      projectId: input.projectId ?? currentProjectId(),
    }),
  })
}

export async function updateRequirement(id: string, patch: RequirementPatch): Promise<RequirementRecord> {
  return request<RequirementRecord>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function removeRequirement(id: string): Promise<boolean> {
  return request<boolean>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" })
}
