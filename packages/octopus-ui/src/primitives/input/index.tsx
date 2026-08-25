import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react"
import { cn } from "../../cn"

const fieldClasses =
  "w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground placeholder:text-text-faint transition-colors duration-fast focus:outline-none focus:border-accent disabled:opacity-50"

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldClasses, "h-9", className)} {...props} />
  ),
)

Input.displayName = "Input"

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  rows?: number
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 2, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(fieldClasses, "resize-none leading-relaxed", className)}
      {...props}
    />
  ),
)

Textarea.displayName = "Textarea"
