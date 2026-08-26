import { useEffect, useMemo, useState } from "react"
import { ThemeProvider } from "octopus-ui"
import { fetchConfig, type WorkbenchConfig } from "./api"
import { ArtifactsRail } from "./components/ArtifactsRail"
import { ChatPane } from "./components/ChatPane"
import { KanbanDrawer } from "./components/KanbanDrawer"
import { NewProjectModal } from "./components/NewProjectModal"
import { ProjectStrip } from "./components/ProjectStrip"
import { TopBar } from "./components/TopBar"
import { createDefaultAgentClient, KANBAN_COLUMNS, PROJECTS } from "./lib/datasource"
import { deriveShortName } from "./lib/short-name"
import type { Artifact, KanbanColumn, KanbanTask, ProjectSummary } from "./lib/types"

type DrawerKind = "tasks" | null

export default function App() {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null)
  useEffect(() => {
    void fetchConfig().then(setConfig)
  }, [])

  // ── 项目域状态（mock 数据源 + 本会话新增）──
  const [projects, setProjects] = useState<ProjectSummary[]>(PROJECTS)
  const [projectId, setProjectId] = useState(projects[0].id)
  const current = projects.find((p) => p.id === projectId) ?? projects[0]

  // ── 看板 ──
  const [columns, setColumns] = useState<KanbanColumn[]>(KANBAN_COLUMNS)

  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const onArtifactsChange = useMemo(() => (a: Artifact[]) => setArtifacts(a), [])

  const agentClient = useMemo(createDefaultAgentClient, [])

  const handleCreateProject = (data: { name: string; description: string }) => {
    const project: ProjectSummary = {
      id: `project-${Date.now()}`,
      name: data.name,
      shortName: deriveShortName(data.name),
      description: data.description || "暂无描述",
      iteration: "未排期",
      dueDate: "-",
      progressPct: 0,
      weeklyDone: 0,
      weeklyTotal: 0,
      activeRequirements: 0,
      overdue: 0,
      members: [],
    }
    setProjects((prev) => [...prev, project])
    setProjectId(project.id)
  }

  const handleCreateTask = (task: KanbanTask) => {
    setColumns((prev) =>
      prev.map((c) => (c.key === task.column ? { ...c, tasks: [task, ...c.tasks] } : c)),
    )
  }

  return (
    <ThemeProvider defaultMode="dark">
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TopBar
          projects={projects}
          currentProjectId={projectId}
          onSwitchProject={setProjectId}
          onOpenNewProject={() => setNewProjectOpen(true)}
        />

        <ProjectStrip
          summary={current}
          onOpenKanban={() => setDrawer("tasks")}
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

        <KanbanDrawer
          open={drawer === "tasks"}
          onClose={() => setDrawer(null)}
          columns={columns}
          onCreateTask={handleCreateTask}
        />

        <NewProjectModal
          open={newProjectOpen}
          onClose={() => setNewProjectOpen(false)}
          onCreate={handleCreateProject}
        />
      </div>
    </ThemeProvider>
  )
}
