import { cn } from "../../cn"

export type SpinnerSize = "sm" | "md"

const sizeClasses: Record<SpinnerSize, string> = {
  sm: "w-3 h-3 border-[1.5px]",
  md: "w-5 h-5 border-2",
}

export interface SpinnerProps {
  size?: SpinnerSize
  className?: string
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className={cn(
        "inline-block rounded-full border-accent border-t-transparent animate-spin",
        sizeClasses[size],
        className,
      )}
    />
  )
}
