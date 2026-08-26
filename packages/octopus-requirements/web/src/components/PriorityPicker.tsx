import type { Priority } from "../types"

export interface PriorityPickerProps {
  value: Priority
  onChange: (p: Priority) => void
  label?: string
}

const OPTIONS: { value: Priority; hint: string }[] = [
  { value: "P0", hint: "紧急" },
  { value: "P1", hint: "高" },
  { value: "P2", hint: "普通" },
]

const activeClasses: Record<Priority, string> = {
  P0: "border-warn/50 bg-warn/10 text-warn",
  P1: "border-info/50 bg-info/10 text-info",
  P2: "border-border-strong bg-surface-hover text-foreground",
}

/** 优先级三档选择（P0/P1/P2），受控组件 */
export function PriorityPicker({ value, onChange, label = "优先级" }: PriorityPickerProps) {
  return (
    <div>
      <div className="mb-1.5 text-xs text-muted-foreground">{label}</div>
      <div className="flex gap-2">
        {OPTIONS.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={
                active
                  ? `flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors duration-fast ${activeClasses[opt.value]}`
                  : "flex-1 cursor-pointer rounded-lg border border-border px-3 py-2 text-[13px] text-muted-foreground transition-colors duration-fast hover:bg-surface"
              }
            >
              {opt.value}
              <span className="ml-1.5 text-[11px] font-normal opacity-75">{opt.hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
