import { cn } from "../../cn"

export interface ProgressBarProps {
  /** 当前值（0..max） */
  value: number
  max?: number
  className?: string
  /** 进度条填充色类，默认品牌色 */
  fillClassName?: string
}

export function ProgressBar({ value, max = 100, className, fillClassName }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(pct)}
      className={cn("h-1 overflow-hidden rounded-full bg-border", className)}
    >
      <div
        className={cn("h-full rounded-full bg-accent transition-[width] duration-normal", fillClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
