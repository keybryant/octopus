export interface WorkbenchConfig {
  title: string
  greeting: string
}

export interface WorkbenchModuleInfo {
  id: string
  title: string
  entry: string
}

export async function fetchConfig(): Promise<WorkbenchConfig | null> {
  try {
    const res = await fetch("/api/octopus/config")
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function fetchModules(): Promise<WorkbenchModuleInfo[]> {
  try {
    const res = await fetch("/api/octopus/modules")
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export type ProjectStatusValue = "active" | "paused" | "done" | "archived"

export interface ProjectRecordView {
  id: string
  name: string
  description: string
  status: ProjectStatusValue
  workspacePath: string
  workspaceId: string
  createdAt: string
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(input, init)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function fetchProjects(): Promise<ProjectRecordView[] | null> {
  const data = await requestJson<{ items: ProjectRecordView[] }>("/api/octopus-projects/projects")
  return data ? data.items : null
}

export async function fetchProjectsConfig(): Promise<{ defaultWorkspaceRoot: string } | null> {
  return requestJson<{ defaultWorkspaceRoot: string }>("/api/octopus-projects/config")
}

export async function createProject(
  input: { name: string; description?: string; status?: ProjectStatusValue },
): Promise<ProjectRecordView | null> {
  const data = await requestJson<{ project: ProjectRecordView }>("/api/octopus-projects/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return data ? data.project : null
}

export async function updateProject(
  id: string,
  patch: { description?: string; status?: ProjectStatusValue },
): Promise<boolean> {
  const data = await requestJson<unknown>(`/api/octopus-projects/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  })
  return data !== null
}

export async function deleteProject(id: string): Promise<boolean> {
  const data = await requestJson<unknown>(`/api/octopus-projects/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  return data !== null
}
