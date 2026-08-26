import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "../../cn"

export interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** 宽度类，默认 max-w-lg */
  widthClass?: string
  children: ReactNode
}

/** 居中模态框：Radix Dialog 底座，自带 Esc/backdrop 关闭与焦点管理 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  widthClass = "max-w-lg",
  children,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="modal-backdrop"
          className="fixed inset-0 z-modal bg-black/60"
        />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-modal w-full -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border-strong bg-background shadow-elev-2",
            "focus:outline-none",
            widthClass,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 pb-3 pt-4">
            <div>
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 text-xs text-text-faint">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="关闭"
              className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors duration-fast hover:bg-surface hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </header>
          <div className="px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
