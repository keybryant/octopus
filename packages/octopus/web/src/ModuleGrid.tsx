import { lazy, Suspense, useMemo, useState, Component, type ReactNode } from "react"
import { loadModule } from "./loadModule"
import type { WorkbenchModuleInfo } from "./api"

interface ModuleCardProps {
  module: WorkbenchModuleInfo
}

function ModuleError({ title }: { title: string }) {
  return <div className="mt-3 text-sm text-danger">模块 {title} 加载失败</div>
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
    <section className="rounded-xl border border-border bg-surface p-4">
      <button type="button" className="cursor-pointer bg-none p-0 text-base font-semibold" onClick={toggle}>
        {module.title}
      </button>
      {open && (
        <ModuleErrorBoundary title={module.title}>
          <Suspense fallback={<div className="mt-3 text-sm opacity-70">加载中…</div>}>
            <Lazy />
          </Suspense>
        </ModuleErrorBoundary>
      )}
    </section>
  )
}

export default function ModuleGrid({ modules }: { modules: WorkbenchModuleInfo[] }) {
  if (modules.length === 0) {
    return <div className="text-[13px] text-text-faint">暂无已装模块</div>
  }
  return (
    <section className="grid w-full grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
      {modules.map((module) => (
        <ModuleCard key={module.id} module={module} />
      ))}
    </section>
  )
}
