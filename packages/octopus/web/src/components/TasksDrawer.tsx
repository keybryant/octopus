import { Component, lazy, Suspense, useMemo, type ReactNode } from "react"
import { Sheet } from "octopus-ui"
import { loadModule } from "../loadModule"

export interface TasksDrawerProps {
  open: boolean
  onClose: () => void
  entry: string | undefined
}

class DrawerErrorBoundary extends Component<{ children: ReactNode; title: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error(`[octopus] 任务看板模块加载失败: ${error.message}`)
  }

  render() {
    if (this.state.failed) return <div className="text-sm text-danger">模块「{this.props.title}」加载失败</div>
    return this.props.children
  }
}

function DrawerContent({ entry, title }: { entry: string; title: string }) {
  const Lazy = useMemo(() => lazy(() => loadModule(entry)), [entry])
  return (
    <DrawerErrorBoundary title={title}>
      <Suspense fallback={<div className="text-sm opacity-70">加载中…</div>}>
        <Lazy />
      </Suspense>
    </DrawerErrorBoundary>
  )
}

/** 任务看板：右侧抽屉加载 octopus-tasks 插件 UI */
export function TasksDrawer({ open, onClose, entry }: TasksDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="任务看板" subtitle="由 octopus-tasks 插件提供">
      {entry === undefined ? (
        <div className="text-sm text-danger">未安装任务模块</div>
      ) : (
        <DrawerContent entry={entry} title="任务看板" />
      )}
    </Sheet>
  )
}
