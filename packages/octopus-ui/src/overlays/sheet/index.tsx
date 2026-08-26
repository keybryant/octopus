import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "../../cn"

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string
  side?: "right"
  /** 面板宽度类，默认 max-w-2xl */
  widthClass?: string
  children: ReactNode
}

export function Sheet({
  open,
  onOpenChange,
  title,
  subtitle,
  side = "right",
  widthClass = "max-w-2xl",
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="drawer-backdrop"
          className="fixed inset-0 z-modal bg-black/60"
        />
        <Dialog.Content
          data-side={side}
          className={cn(
            "fixed inset-y-0 right-0 z-modal flex w-full flex-col",
            "border-l border-border-strong bg-background",
            widthClass,
          )}
        >
          <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border px-5">
            <div className="flex items-center gap-2.5">
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              {subtitle && (
                <span className="text-xs text-text-faint">{subtitle}</span>
              )}
            </div>
            <Dialog.Close
              aria-label="关闭"
              className="rounded-md p-1.5 text-muted-foreground transition-colors duration-fast hover:bg-surface hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
