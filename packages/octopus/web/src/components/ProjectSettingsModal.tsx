import { useEffect, useState } from "react"
import { Button, Modal, Textarea } from "octopus-ui"

export type SettingsProject = {
  id: string
  name: string
  description: string
  status: "active" | "paused" | "done" | "archived"
  workspacePath: string
  createdAt: string
}

export interface ProjectSettingsModalProps {
  open: boolean
  onClose: () => void
  project: SettingsProject | null
  onSave: (data: { description: string; status: SettingsProject["status"] }) => Promise<boolean>
  onDelete: () => Promise<boolean>
}

const STATUS_OPTIONS = [
  { value: "active", label: "进行中" },
  { value: "paused", label: "已暂停" },
  { value: "done", label: "已完成" },
  { value: "archived", label: "已归档" },
] as const

export function ProjectSettingsModal({ open, onClose, project, onSave, onDelete }: ProjectSettingsModalProps) {
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<SettingsProject["status"]>("active")
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && project) {
      setDescription(project.description)
      setStatus(project.status)
    }
    if (!open) {
      setConfirmingDelete(false)
      setError(null)
    }
  }, [open, project])

  if (!project) return null

  const handleSave = async () => {
    setBusy(true)
    setError(null)
    const ok = await onSave({ description, status })
    setBusy(false)
    if (ok) onClose()
    else setError("保存失败，请重试")
  }

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setBusy(true)
    setError(null)
    const ok = await onDelete()
    setBusy(false)
    if (ok) onClose()
    else setError("删除失败，请重试")
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="项目设置" description="编辑项目信息或删除项目">
      <div className="space-y-4">
        <div className="grid grid-cols-[72px_1fr] items-center gap-y-2 text-xs">
          <span className="text-muted-foreground">名称</span>
          <span className="truncate text-sm font-medium">{project.name}</span>
          <span className="text-muted-foreground">工作区</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{project.workspacePath}</span>
          <span className="text-muted-foreground">创建时间</span>
          <span className="text-sm">{new Date(project.createdAt).toLocaleString()}</span>
        </div>
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">项目介绍</div>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明项目目标" />
        </div>
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">项目状态</div>
          <div className="flex overflow-hidden rounded-lg border border-border">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatus(opt.value)}
                className={
                  "flex-1 py-1.5 text-xs transition-colors duration-fast " +
                  (status === opt.value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground")
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {error && <div className="text-xs text-danger">{error}</div>}
        <div className="flex items-center border-t border-border pt-3">
          <Button variant="danger" size="sm" disabled={busy} onClick={handleDelete}>
            {confirmingDelete ? "确认删除？" : "删除项目"}
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={handleSave}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
