import { useState } from "react"
import { Avatar, Button, Input, Modal, Textarea } from "octopus-ui"
import { deriveShortName } from "../lib/short-name"

export interface NewProjectModalProps {
  open: boolean
  onClose: () => void
  onCreate: (data: { name: string; description: string }) => void
}

export function NewProjectModal({ open, onClose, onCreate }: NewProjectModalProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const preview = deriveShortName(name)
  const canSubmit = name.trim().length > 0

  const submit = () => {
    if (!canSubmit) return
    onCreate({
      name: name.trim(),
      description: description.trim(),
    })
    setName("")
    setDescription("")
    onClose()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="新建项目"
      description="创建一个新的项目工作区"
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            项目名称 *
            {preview && (
              <span className="inline-flex items-center gap-1.5 text-text-faint">
                头像
                <Avatar initials={preview} size="xs" />
              </span>
            )}
          </div>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：Octopus Platform"
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">项目描述</div>
          <Textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话说明项目目标"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            创建项目
          </Button>
        </div>
      </div>
    </Modal>
  )
}
