export interface WorkbenchModule {
  id: string
  title: string
  order?: number
  entry: string
  /** 缺省视为 'authenticated'；'admin' 仅管理员可见 */
  access?: "authenticated" | "admin"
}

export interface WorkbenchRegistry {
  register(module: WorkbenchModule): () => void
  list(): WorkbenchModule[]
}

export function createRegistry(): WorkbenchRegistry {
  const modules = new Map<string, WorkbenchModule>()
  return {
    register(module) {
      if (modules.has(module.id)) {
        throw new Error(`[octopus] duplicate workbench module id: ${module.id}`)
      }
      modules.set(module.id, module)
      return () => {
        modules.delete(module.id)
      }
    },
    list() {
      return [...modules.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    },
  }
}
