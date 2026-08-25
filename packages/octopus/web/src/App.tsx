import { useEffect, useState } from "react"
import { fetchConfig, fetchModules, type WorkbenchConfig, type WorkbenchModuleInfo } from "./api"
import { timeGreeting } from "./greeting"
import ModuleGrid from "./ModuleGrid"

const DEFAULT_TITLE = "My Workbench"

export default function App() {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null)
  const [modules, setModules] = useState<WorkbenchModuleInfo[]>([])
  useEffect(() => {
    void fetchConfig().then(setConfig)
    void fetchModules().then(setModules)
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
      <ModuleGrid modules={modules} />
    </main>
  )
}
