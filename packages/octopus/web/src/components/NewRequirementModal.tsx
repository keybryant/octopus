import { useState } from "react"
import { Button, Input, Modal } from "octopus-ui"
import { PriorityPicker } from "./PriorityPicker"

export interface NewRequirementModalProps {
  open: boolean
  onClose: () => void
  onCreate: (data: { title: string; priority: "P0" | "P1" | "P2" }) => void
}

export function NewRequirementModal({ open, onClose, onCreate }: NewRequirementModalProps) {
  const [title, setTitle] = useState("")
  const [priority, setPriority] = useState<"P0" | "P1" | "P2">("P1")

  const canSubmit = title.trim().length > 0

  const submit = () => {
    if (!canSubmit) return
    onCreate({ title: title.trim(), priority })
    setTitle("")
    setPriority("P1")
    onClose()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
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
          />
        </div>
        <PriorityPicker value={priority} onChange={setPriority} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            创建需求
          </Button>
        </div>
      </div>
    </Modal>
  )
}
