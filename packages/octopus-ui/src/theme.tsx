import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

export type ThemeMode = "light" | "dark"

interface ThemeContextValue {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "dark",
  setMode: () => {},
})

function systemMode(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export interface ThemeProviderProps {
  children: ReactNode
  /** 无存储偏好时的初始模式；不传则跟随系统 */
  defaultMode?: ThemeMode
  storageKey?: string
}

export function ThemeProvider({ children, defaultMode, storageKey = "octopus-ui-mode" }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored === "light" || stored === "dark") return stored
    return defaultMode ?? systemMode()
  })

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode)
  }, [mode])

  const setMode = (next: ThemeMode) => {
    localStorage.setItem(storageKey, next)
    setModeState(next)
  }

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
