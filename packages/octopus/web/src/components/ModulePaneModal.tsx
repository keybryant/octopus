import { lazy, Suspense, useMemo, Component, type ReactNode } from "react"
import { Modal } from "octopus-ui"
import { loadModule } from "../loadModule"

export interface ModulePaneModalProps {
  open: boolean
  title: string
  entry: string | undefined
  onClose: () => void
}

class PaneErrorBoundary extends Component<{ children: ReactNode; title: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error(`[octopus] 面板模块加载失败: ${error.message}`)
  }

  render() {
    if (this.state.failed) return <div className="text-sm text-danger">模块「{this.props.title}」加载失败</div>
    return this.props.children
  }
}

function PaneContent({ entry, title }: { entry: string; title: string }) {
  const Lazy = useMemo(() => lazy(() => loadModule(entry)), [entry])
  return (
    <PaneErrorBoundary title={title}>
      <Suspense fallback={<div className="text-sm opacity-70">加载中…</div>}>
        <Lazy />
      </Suspense>
    </PaneErrorBoundary>
  )
}

export function ModulePaneModal({ open, title, entry, onClose }: ModulePaneModalProps) {
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={title} widthClass="max-w-3xl">
      {entry === undefined ? (
        <div className="text-sm text-danger">未安装用户管理模块</div>
      ) : (
        <PaneContent entry={entry} title={title} />
      )}
    </Modal>
  )
}
