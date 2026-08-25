import type { ComponentType } from "react"

export function loadModule(entry: string): Promise<{ default: ComponentType }> {
  return import(/* @vite-ignore */ entry)
}
