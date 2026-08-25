import { lazy, Suspense, useMemo, useState, Component, type ReactNode } from "react"
import { loadModule } from "./loadModule"
import type { WorkbenchModuleInfo } from "./api"

interface ModuleCardProps {
  module: WorkbenchModuleInfo
}

function ModuleError({ title }: { title: string }) {
  return <div className="module-error">模块 {title} 加载失败</div>
}

class ModuleErrorBoundary extends Component<{ children: ReactNode; title: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error(`[octopus] 模块加载失败: ${error.message}`)
  }

  render() {
    if (this.state.failed) return <ModuleError title={this.props.title} />
    return this.props.children
  }
}

function ModuleCard({ module }: ModuleCardProps) {
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const Lazy = useMemo(() => lazy(() => loadModule(module.entry)), [module.entry, attempt])
  const toggle = () => {
    if (open) setAttempt((a) => a + 1)
    setOpen(!open)
  }
  return (
    <section className="module-card">
      <button type="button" className="module-title" onClick={toggle}>
        {module.title}
      </button>
      {open && (
        <ModuleErrorBoundary title={module.title}>
          <Suspense fallback={<div className="module-loading">加载中…</div>}>
            <Lazy />
          </Suspense>
        </ModuleErrorBoundary>
      )}
    </section>
  )
}

export default function ModuleGrid({ modules }: { modules: WorkbenchModuleInfo[] }) {
  if (modules.length === 0) return null
  return (
    <section className="modules">
      {modules.map((module) => (
        <ModuleCard key={module.id} module={module} />
      ))}
    </section>
  )
}
