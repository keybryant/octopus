import * as RDX from "@radix-ui/react-dropdown-menu"
import type { ComponentPropsWithoutRef, ReactNode } from "react"
import { cn } from "../../cn"

const contentClasses =
  "z-dropdown min-w-[200px] rounded-lg border border-border-strong bg-surface p-1 shadow-elev-2 " +
  "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1"

const itemClasses =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-muted-foreground " +
  "outline-none transition-colors duration-fast data-highlighted:bg-surface-hover data-highlighted:text-foreground"

export const DropdownMenu = RDX.DropdownMenu
export const DropdownMenuTrigger = RDX.DropdownMenuTrigger

export interface DropdownMenuContentProps extends ComponentPropsWithoutRef<typeof RDX.DropdownMenuContent> {
  children: ReactNode
}

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: DropdownMenuContentProps) {
  return (
    <RDX.Portal>
      <RDX.DropdownMenuContent
        sideOffset={sideOffset}
        className={cn(contentClasses, className)}
        {...props}
      />
    </RDX.Portal>
  )
}

export type DropdownMenuItemProps = ComponentPropsWithoutRef<typeof RDX.DropdownMenuItem>

export function DropdownMenuItem({ className, ...props }: DropdownMenuItemProps) {
  return <RDX.DropdownMenuItem className={cn(itemClasses, className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof RDX.DropdownMenuLabel>) {
  return (
    <RDX.DropdownMenuLabel
      className={cn(
        "px-4 pt-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-faint",
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof RDX.DropdownMenuSeparator>) {
  return (
    <RDX.DropdownMenuSeparator
      className={cn("my-1 h-px border-0 bg-border", className)}
      {...props}
    />
  )
}
