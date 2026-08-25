import { cn } from "../../cn"

export type AvatarSize = "xs" | "sm" | "md"

const sizeClasses: Record<AvatarSize, string> = {
  xs: "w-5 h-5 text-[9px]",
  sm: "w-6 h-6 text-[10px]",
  md: "w-8 h-8 text-xs",
}

export interface AvatarProps {
  initials: string
  size?: AvatarSize
  className?: string
}

export function Avatar({ initials, size = "sm", className }: AvatarProps) {
  return (
    <span
      aria-label={initials}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-info/15 font-medium text-info",
        sizeClasses[size],
        className,
      )}
    >
      {initials}
    </span>
  )
}
