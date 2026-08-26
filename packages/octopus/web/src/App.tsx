import { useEffect, useMemo, useState } from "react"
import { ThemeProvider } from "octopus-ui"
import { fetchConfig, fetchModules, type WorkbenchConfig, type WorkbenchModuleInfo } from "./api"
import { ArtifactsRail } from "./components/ArtifactsRail"
import { ChatPane } from "./components/ChatPane"
import { KanbanDrawer } from "./components/KanbanDrawer"
import { ModulesDrawer } from "./components/ModulesDrawer"
import { ProjectStrip } from "./components/ProjectStrip"
import { RequirementsDrawer } from "./components/RequirementsDrawer"
import { TopBar } from "./components/TopBar"
import { createDefaultAgentClient, PROJECTS } from "./lib/datasource"
import type { Artifact } from "./lib/types"

type DrawerKind = "tasks" | "reqs" | "modules" | null

export default function App() {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null)
  useEffect(() => {
    void fetchConfig().then(setConfig)
  }, [])

  const projects = PROJECTS
  const [projectId, setProjectId] = useState(projects[0].id)
  const current = projects.find((p) => p.id === projectId) ?? projects[0]

  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const onArtifactsChange = useMemo(() => (a: Artifact[]) => setArtifacts(a), [])

  const [modules, setModules] = useState<WorkbenchModuleInfo[]>([])
  useEffect(() => {
    void fetchModules().then(setModules)
  }, [])

  const agentClient = useMemo(createDefaultAgentClient, [])

  return (
    <ThemeProvider defaultMode="dark">
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TopBar
          projects={projects}
          currentProjectId={projectId}
          onSwitchProject={setProjectId}
          onOpenModules={() => setDrawer("modules")}
        />

        <ProjectStrip
          summary={current}
          onOpenKanban={() => setDrawer("tasks")}
          onOpenRequirements={() => setDrawer("reqs")}
        />

        <div className="flex min-h-0 flex-1">
          <ChatPane agentClient={agentClient} onArtifactsChange={onArtifactsChange} />
          <ArtifactsRail
            artifacts={artifacts}
            collapsed={railCollapsed}
            onCollapse={() => setRailCollapsed(true)}
            onExpand={() => setRailCollapsed(false)}
          />
        </div>

        <KanbanDrawer open={drawer === "tasks"} onClose={() => setDrawer(null)} />
        <RequirementsDrawer open={drawer === "reqs"} onClose={() => setDrawer(null)} />
        <ModulesDrawer open={drawer === "modules"} onClose={() => setDrawer(null)} modules={modules} />
      </div>
    </ThemeProvider>
  )
}
