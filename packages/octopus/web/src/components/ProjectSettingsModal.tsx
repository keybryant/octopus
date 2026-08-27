import { useEffect, useState } from "react"
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Modal, Textarea } from "octopus-ui"
import { Check, ChevronDown } from "octopus-ui"

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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && project) {
      setDescription(project.description)
      setStatus(project.status)
    }
    if (!open) {
      setDeleteOpen(false)
      setError(null)
    }
  }, [open, project?.id])

  if (!project) return null

  const handleSave = async () => {
    setBusy(true)
    setError(null)
    const ok = await onSave({ description, status })
    setBusy(false)
    if (ok) onClose()
    else setError("保存失败，请重试")
  }

  const handleConfirmDelete = async () => {
    setBusy(true)
    setError(null)
    const ok = await onDelete()
    setBusy(false)
    if (ok) {
      setDeleteOpen(false)
      onClose()
    } else {
      setDeleteOpen(false)
      setError("删除失败，请重试")
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="项目设置" description="编辑项目信息或删除项目">
      <div className="space-y-4">
        <div className="grid grid-cols-[72px_1fr] items-center gap-y-2 text-xs">
          <span className="text-muted-foreground">名称</span>
          <span className="truncate text-sm font-medium">{project.name}</span>
          <span className="text-muted-foreground">编号</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{project.id}</span>
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
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-[13px] transition-colors duration-fast hover:bg-surface-hover focus:border-accent focus:outline-none"
            >
              <span>{STATUS_OPTIONS.find((o) => o.value === status)?.label}</span>
              <ChevronDown className="h-3.5 w-3.5 text-text-faint" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem key={opt.value} onSelect={() => setStatus(opt.value)}>
                  <span className="flex-1">{opt.label}</span>
                  {status === opt.value && <Check className="h-4 w-4 text-accent" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {error && <div className="text-xs text-danger">{error}</div>}
        <div className="flex items-center border-t border-border pt-3">
          <Button variant="danger" size="sm" disabled={busy} onClick={() => setDeleteOpen(true)}>
            删除项目
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={handleSave}>保存</Button>
        </div>
      </div>

      <Modal open={deleteOpen} onOpenChange={(o) => !o && setDeleteOpen(false)} title="删除项目" widthClass="max-w-sm">
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            确定要删除项目「{project.name}」吗？此操作仅移除工作台中的项目记录，工作区目录与 dsh 工作区将保留。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={handleConfirmDelete}>确认删除</Button>
          </div>
        </div>
      </Modal>
    </Modal>
  )
}
