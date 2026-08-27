import { useEffect, useState } from "react"
import { Button, Input, Modal, Textarea } from "octopus-ui"
import type { Priority, RequirementRecord } from "../types"
import { PriorityPicker } from "./PriorityPicker"

export interface NewRequirementInput {
  title: string
  description: string
  priority: Priority
  owner: string
}

export interface NewRequirementModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: NewRequirementInput) => Promise<void> | void
  submitting?: boolean
  initial?: RequirementRecord | null
}

export function NewRequirementModal({ open, onClose, onSubmit, submitting = false, initial = null }: NewRequirementModalProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<Priority>("P1")
  const [owner, setOwner] = useState("")

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? "")
    setDescription(initial?.description ?? "")
    setPriority(initial?.priority ?? "P1")
    setOwner(initial?.owner ?? "")
  }, [open, initial])

  const canSubmit = title.trim().length > 0 && !submitting
  const isEdit = initial !== null && initial !== undefined

  const submit = async () => {
    if (!canSubmit) return
    await onSubmit({ title: title.trim(), description: description.trim(), priority, owner: owner.trim() })
    setTitle("")
    setDescription("")
    setPriority("P1")
    setOwner("")
    onClose()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !submitting && onClose()}
      title={isEdit ? "编辑需求" : "新建需求"}
      description={isEdit ? "修改需求内容" : "描述一个待实现的产品需求"}
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
            placeholder="背景、目标、验收要点（可选）"
            rows={3}
          />
        </div>
        <PriorityPicker value={priority} onChange={setPriority} />
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">负责人</div>
          <Input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="负责人（可选）"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? (isEdit ? "保存中" : "创建中") : (isEdit ? "保存修改" : "创建需求")}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
