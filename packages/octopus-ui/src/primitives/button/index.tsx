import { forwardRef, type ButtonHTMLAttributes } from "react"
import { cn } from "../../cn"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md" | "lg"

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:brightness-110 font-medium",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-hover hover:border-border-strong",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-surface",
  danger:
    "bg-danger text-white hover:brightness-110 font-medium",
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs rounded-sm gap-1.5",
  md: "h-9 px-4 text-[13px] rounded-lg gap-2",
  lg: "h-11 px-6 text-sm rounded-lg gap-2",
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap transition duration-fast",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
        "disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
)

Button.displayName = "Button"
