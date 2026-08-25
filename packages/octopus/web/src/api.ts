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
