import { useCallback, useEffect, useRef, useState } from "react"
import { Button, Spinner } from "octopus-ui"
import { createTaskBatch, decomposeTasks, listTasks, updateTask } from "./api"
import { DecomposeDraftsModal, type DecomposePayload, type DraftRow } from "./components/DecomposeDraftsModal"
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
  const [payload, setPayload] = useState<DecomposePayload | null>(null)
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftRows, setDraftRows] = useState<DraftRow[]>([])
  const [draftSubmitting, setDraftSubmitting] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

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
      const prevTask = tasks.find((t) => t.id === id) ?? null
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)))
      try {
        const updated = await updateTask(id, { status })
        setTasks((ts) => ts.map((t) => (t.id === id ? updated : t)))
      } catch (e) {
        if (prevTask) setTasks((ts) => ts.map((t) => (t.id === id ? prevTask : t)))
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

  /** 打开拆解草稿弹窗：请求 AI 拆解 → 草稿行，空草稿兜底一行可编辑 */
  const openDrafts = useCallback(async (p: DecomposePayload) => {
    setPayload(p)
    setDraftOpen(true)
    setDraftError(null)
    setDraftLoading(true)
    try {
      const drafts = await decomposeTasks({
        requirementId: p.requirementId,
        title: p.title,
        description: p.description,
      })
      const rows = drafts.length > 0 ? drafts : [{ title: "" }]
      setDraftRows(rows.map((d) => ({ ...d, key: rowKeyRef.current++, checked: true })))
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e))
      setDraftRows([])
    } finally {
      setDraftLoading(false)
    }
  }, [])

  const rowKeyRef = useRef(0)

  // 消费 shell 写入的拆解载荷（读后清空，仅生效一次）
  useEffect(() => {
    const holder = window as unknown as { __octopusDecomposePayload?: DecomposePayload }
    const incoming = holder.__octopusDecomposePayload
    if (incoming) {
      holder.__octopusDecomposePayload = undefined
      void openDrafts(incoming)
    }
  }, [openDrafts])

  /** 提交草稿任务：批量创建 → 合并进看板并按 id 排序 → 关闭弹窗 */
  const handleSubmitDrafts = async () => {
    if (!payload) return
    setDraftSubmitting(true)
    setDraftError(null)
    setError(null)
    try {
      const tasks = draftRows
        .filter((r) => r.checked && r.title.trim().length > 0)
        .map((r) => ({
          title: r.title.trim(),
          description: r.description ?? "",
        }))
      const created = await createTaskBatch({
        requirementId: payload.requirementId,
        tasks,
      })
      setTasks((prev) => [...prev, ...created].sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5))))
      setDraftOpen(false)
      setPayload(null)
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e))
    } finally {
      setDraftSubmitting(false)
    }
  }

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

      <DecomposeDraftsModal
        open={draftOpen}
        payload={payload}
        loading={draftLoading}
        rows={draftRows}
        submitting={draftSubmitting}
        error={draftError}
        onRowChange={(key, patch) =>
          setDraftRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
        }
        onRetry={() => payload && void openDrafts(payload)}
        onClose={() => {
          if (draftSubmitting) return
          setDraftOpen(false)
          setPayload(null)
        }}
        onSubmit={() => void handleSubmitDrafts()}
      />
    </section>
  )
}
