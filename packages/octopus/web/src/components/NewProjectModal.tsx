import { Modal, Input, Textarea, Button } from "octopus-ui"
import { useState } from "react"

export interface NewProjectModalProps {
  open: boolean
  onClose: () => void
  onCreate: (data: { name: string; shortName: string; description: string }) => void
}

/** 由名称推导两字母缩写：中文取前两字，英文取前两个单词首字母 */
export function deriveShortName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ""
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(0, 2)
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

export function NewProjectModal({ open, onClose, onCreate }: NewProjectModalProps) {
  const [name, setName] = useState("")
  const [shortName, setShortName] = useState("")
  const [description, setDescription] = useState("")

  const effectiveShort = shortName.trim() || deriveShortName(name)
  const canSubmit = name.trim().length > 0

  const submit = () => {
    if (!canSubmit) return
    onCreate({
      name: name.trim(),
      shortName: effectiveShort.toUpperCase().slice(0, 2),
      description: description.trim(),
    })
    setName("")
    setShortName("")
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
          <div className="mb-1.5 text-xs text-muted-foreground">项目名称 *</div>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：Octopus Platform"
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            缩写标识
            {effectiveShort && (
              <span className="ml-2 font-mono text-accent">{effectiveShort.toUpperCase()}</span>
            )}
          </div>
          <Input
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            maxLength={2}
            placeholder={effectiveShort ? `留空自动生成：${effectiveShort}` : "两字符，如 OP"}
            className="w-40 font-mono uppercase"
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
