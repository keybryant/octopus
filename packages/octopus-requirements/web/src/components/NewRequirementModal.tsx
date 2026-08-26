import { useState } from "react"
import { Button, Input, Modal, Textarea } from "octopus-ui"
import type { Priority } from "../types"
import { PriorityPicker } from "./PriorityPicker"

export interface NewRequirementInput {
  title: string
  description: string
  priority: Priority
}

export interface NewRequirementModalProps {
  open: boolean
  onClose: () => void
  onCreate: (data: NewRequirementInput) => Promise<void> | void
  submitting?: boolean
}

export function NewRequirementModal({ open, onClose, onCreate, submitting = false }: NewRequirementModalProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<Priority>("P1")

  const canSubmit = title.trim().length > 0 && !submitting

  const submit = async () => {
    if (!canSubmit) return
    await onCreate({ title: title.trim(), description: description.trim(), priority })
    setTitle("")
    setDescription("")
    setPriority("P1")
    onClose()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !submitting && onClose()}
      title="新建需求"
      description="描述一个待实现的产品需求"
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">需求标题 *</div>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：多租户权限体系升级"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
            }}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">需求描述</div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="背景、目标、验收要点…（可选）"
            rows={3}
          />
        </div>
        <PriorityPicker value={priority} onChange={setPriority} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "创建中…" : "创建需求"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
