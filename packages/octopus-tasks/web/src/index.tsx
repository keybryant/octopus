import { useCallback, useEffect, useState } from "react"
import { Button, Spinner } from "octopus-ui"
import { listTasks, updateTask } from "./api"
import { TaskBoard } from "./components/TaskBoard"
import type { TaskRecord, TaskStatus } from "./types"
import "./index.css"

/** workbench 模块：任务看板 */
export default function TasksModule() {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTasks(await listTasks())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 拖拽迁卡：乐观更新，失败回滚并提示 */
  const handleMove = useCallback(
    async (id: string, status: TaskStatus) => {
      setMoveError(null)
      setBusyIds((prev) => new Set(prev).add(id))
      const prev = tasks
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)))
      try {
        const updated = await updateTask(id, { status })
        setTasks((ts) => ts.map((t) => (t.id === id ? updated : t)))
      } catch (e) {
        setTasks(prev)
        setMoveError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyIds((s) => {
          const next = new Set(s)
          next.delete(id)
          return next
        })
      }
    },
    [tasks],
  )

  return (
    <section className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-base font-semibold">任务看板</h2>
        <span className="text-xs text-text-faint">共 {tasks.length} 个</span>
        <span className="text-[11px] text-text-faint">从需求列表行内「拆解任务」入口拆分新任务</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-6 text-center text-sm text-danger">
          {error}
          <div className="mt-2">
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              重试
            </Button>
          </div>
        </div>
      ) : (
        <>
          {moveError && (
            <div className="mb-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
              {moveError}
            </div>
          )}
          <TaskBoard tasks={tasks} busyIds={busyIds} onMove={handleMove} />
        </>
      )}
    </section>
  )
}
