export interface OctoLogoProps {
  className?: string
}

/** 八爪鱼品牌标（描边风格）。产品品牌件，不入设计系统包。 */
export function OctoLogo({ className }: OctoLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3c-3.5 0-6 2.4-6 5.2 0 1.7.8 3.2 2 4.2v2.4c0 1.8 1.8 3.2 4 3.2s4-1.4 4-3.2v-2.4c1.2-1 2-2.5 2-4.2C18 5.4 15.5 3 12 3z" />
      <circle cx="9.5" cy="8" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="8" r="0.5" fill="currentColor" stroke="none" />
      <path d="M8 17.5L6.5 21M11 18v3M14 18l1.5 3M16.5 16.5L19 19.5" />
    </svg>
  )
}
