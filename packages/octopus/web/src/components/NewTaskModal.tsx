import { useState } from "react"
import { Button, Input, Modal } from "octopus-ui"
import { PriorityPicker } from "./PriorityPicker"

export interface NewTaskModalProps {
  open: boolean
  onClose: () => void
  onCreate: (data: { title: string; priority: "P0" | "P1" | "P2"; assignee?: string }) => void
}

export function NewTaskModal({ open, onClose, onCreate }: NewTaskModalProps) {
  const [title, setTitle] = useState("")
  const [priority, setPriority] = useState<"P0" | "P1" | "P2">("P1")
  const [assignee, setAssignee] = useState("")

  const canSubmit = title.trim().length > 0

  const submit = () => {
    if (!canSubmit) return
    onCreate({
      title: title.trim(),
      priority,
      assignee: assignee.trim() || undefined,
    })
    setTitle("")
    setPriority("P1")
    setAssignee("")
    onClose()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="新建任务"
      description="在当前迭代创建一个开发任务"
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">任务标题 *</div>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：导出报表支持 CSV 格式"
          />
        </div>
        <PriorityPicker value={priority} onChange={setPriority} />
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">负责人（可选）</div>
          <Input
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="留空则进入待认领池"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            创建任务
          </Button>
        </div>
      </div>
    </Modal>
  )
}
