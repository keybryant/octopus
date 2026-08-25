import type { HTMLAttributes } from "react"
import { cn } from "../../cn"

export type BadgeTone = "success" | "info" | "warn" | "neutral" | "danger"

const toneClasses: Record<BadgeTone, string> = {
  success: "bg-accent/10 text-accent",
  info: "bg-info/10 text-info",
  warn: "bg-warn/10 text-warn",
  neutral: "bg-muted-foreground/10 text-muted-foreground",
  danger: "bg-danger/10 text-danger",
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-[18px]",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  )
}
