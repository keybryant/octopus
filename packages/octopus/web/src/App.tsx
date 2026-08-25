import { useEffect, useState } from "react"
import { fetchConfig, type WorkbenchConfig } from "./api"
import { timeGreeting } from "./greeting"

const DEFAULT_TITLE = "My Workbench"

export default function App() {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null)
  useEffect(() => {
    void fetchConfig().then(setConfig)
  }, [])
  const greeting = config?.greeting || timeGreeting(new Date().getHours())
  return (
    <main className="shell">
      <header className="hero">
        <h1>{config?.title ?? DEFAULT_TITLE}</h1>
        <p className="greeting">{greeting}</p>
      </header>
      <nav className="links">
        <a href="/">进入主界面</a>
        <a href="/marketplace">插件市场</a>
        <a href="/settings">设置</a>
      </nav>
    </main>
  )
}
