import { useRef, useState } from "react"
import { Button, Textarea } from "octopus-ui"
import { Paperclip, SendHorizontal } from "octopus-ui"

export interface ComposerProps {
  quickPrompts: string[]
  disabled?: boolean
  contextLabel: string
  onSend: (text: string) => void
}

export function Composer({ quickPrompts, disabled = false, contextLabel, onSend }: ComposerProps) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue("")
    inputRef.current?.focus()
  }

  return (
    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
      {/* 快捷指令 chips */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {quickPrompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setValue(p)
              inputRef.current?.focus()
            }}
            className="shrink-0 cursor-pointer rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors duration-fast hover:bg-surface-hover hover:text-foreground"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-surface p-3 transition-colors duration-fast focus-within:border-accent">
        <Textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder="给 Octo Agent 下指令，例如「帮我把 REQ-118 的联调提前安排」"
          className="border-0 bg-transparent p-0 focus:border-transparent"
        />
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-1 text-text-faint">
            <button
              type="button"
              className="rounded-md p-1.5 transition-colors hover:bg-surface-hover hover:text-muted-foreground"
              aria-label="附件"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11.5px] transition-colors hover:border-border-strong hover:text-muted-foreground"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_2px_rgba(52,211,153,0.15)]" />
              上下文：{contextLabel}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-faint">
              ⏎ 发送
            </span>
            <Button
              variant="primary"
              size="sm"
              className="h-8 w-8 px-0"
              onClick={submit}
              title="发送"
              aria-label="发送"
            >
              <SendHorizontal className="h-4 w-4 -rotate-90" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
