import { useEffect, useState } from "react"
import { Button, Input, Modal, Spinner } from "octopus-ui"
import type { TaskDraft } from "../types"

export interface DraftRow extends TaskDraft {
  key: number
  checked: boolean
}

export interface DecomposePayload {
  requirementId: string
  title: string
  description?: string
  priority?: "P0" | "P1" | "P2"
}

export interface DecomposeDraftsModalProps {
  open: boolean
  payload: DecomposePayload | null
  loading: boolean
  rows: DraftRow[]
  submitting: boolean
  error: string | null
  onRowChange: (key: number, patch: Partial<DraftRow>) => void
  onRetry: () => void
  onClose: () => void
  onSubmit: () => void
}

const PRIORITY_OPTIONS = ["P0", "P1", "P2"] as const

/** AI 拆解草稿确认弹窗：勾选/编辑草稿 → 批量创建（全有或全无） */
export function DecomposeDraftsModal({
  open,
  payload,
  loading,
  rows,
  submitting,
  error,
  onRowChange,
  onRetry,
  onClose,
  onSubmit,
}: DecomposeDraftsModalProps) {
  const [collapsed, setCollapsed] = useState<number | null>(null)
  useEffect(() => {
    if (!open) setCollapsed(null)
  }, [open])

  const canSubmit = rows.some((r) => r.checked && r.title.trim().length > 0) && !submitting

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !submitting && onClose()}
      title="拆解任务"
      description={payload ? `从需求 ${payload.title} 拆解出的任务草稿（AI 可编辑确认）` : "拆分任务草稿"}
    >
      {payload ? (
        <div className="space-y-3">
          <div className="text-xs text-text-faint">
            需求：{payload.title}
            {payload.priority ? ` · ${payload.priority}` : ""}
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <>
              {rows.map((row) => (
                <div key={row.key} className="rounded-xl border border-border bg-surface p-3">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) => onRowChange(row.key, { checked: e.target.checked })}
                    />
                    <span className="flex-1">
                      <Input
                        value={row.title}
                        aria-label={`任务标题 ${row.key}`}
                        onChange={(e) => onRowChange(row.key, { title: e.target.value })}
                        disabled={!row.checked}
                      />
                    </span>
                    <select
                      value={row.priority ?? "P1"}
                      aria-label={`优先级 ${row.key}`}
                      disabled={!row.checked}
                      onChange={(e) => onRowChange(row.key, { priority: e.target.value as TaskDraft["priority"] })}
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </>
          )}

          {error && !loading && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>}

          <div className="flex justify-end gap-2 pt-1">
            {loading && (
              <Button variant="ghost" size="sm" onClick={onRetry}>
                重新生成
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button variant="primary" disabled={!canSubmit} onClick={onSubmit}>
              {submitting ? "创建中…" : `创建任务（${rows.filter((r) => r.checked && r.title.trim()).length}）`}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
