import type { ProjectsTableLike, ProjectView } from "./api.js"

export type { ProjectView } from "./api.js"

export interface ProjectStoreLike {
  list(): ProjectView[]
  get(id: string): ProjectView | undefined
}

/** 项目只读视图服务（供 octopus-workflow 工具查询 workspacePath 等；写操作仍走 REST） */
export function createProjectStore(projects: ProjectsTableLike): ProjectStoreLike {
  return {
    list() {
      return [...projects.entries()]
        .map(([id, record]) => ({ id, ...record }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    get(id) {
      const record = projects.get(id)
      return record ? { id, ...record } : undefined
    },
  }
}
