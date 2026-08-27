import { useEffect, useMemo, useState } from "react"
import { ThemeProvider } from "octopus-ui"
import { fetchConfig, fetchModules, type WorkbenchConfig, type WorkbenchModuleInfo } from "./api"
import { ArtifactsRail } from "./components/ArtifactsRail"
import { ChatPane } from "./components/ChatPane"
import { KanbanDrawer } from "./components/KanbanDrawer"
import { ModulePaneModal } from "./components/ModulePaneModal"
import { NewProjectModal } from "./components/NewProjectModal"
import { NewRequirementModal } from "./components/NewRequirementModal"
import { ProjectStrip } from "./components/ProjectStrip"
import { RequirementsDrawer } from "./components/RequirementsDrawer"
import { TopBar } from "./components/TopBar"
import {
  createDefaultAgentClient,
  KANBAN_COLUMNS,
  PROJECTS,
  REQUIREMENTS,
} from "./lib/datasource"
import { fetchMe, logout, redirectToLogin, type MeResponse } from "./lib/auth"
import { deriveShortName } from "./lib/short-name"
import type {
  Artifact,
  KanbanColumn,
  KanbanTask,
  ProjectSummary,
  Requirement,
} from "./lib/types"

type DrawerKind = "tasks" | "reqs" | null

function nextId(items: { id: string }[], prefix: string): string {
  const max = Math.max(
    ...items.map((i) => Number(i.id.replace(prefix, "")) || 0),
    prefix === "REQ-" ? 100 : 2800,
  )
  return `${prefix}${max + 1}`
}

export default function App() {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null)
  useEffect(() => {
    void fetchConfig().then(setConfig)
  }, [])

  const [me, setMe] = useState<MeResponse | null>(null)
  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch(() => redirectToLogin())
  }, [])

  const [modules, setModules] = useState<WorkbenchModuleInfo[]>([])
  useEffect(() => {
    void fetchModules().then(setModules)
  }, [])
  const usersViewEntry = modules.find((m) => m.id === "users-view")?.entry
  const [userPaneOpen, setUserPaneOpen] = useState(false)

  // ── 项目域状态（mock 数据源 + 本会话新增）──
  const [projects, setProjects] = useState<ProjectSummary[]>(PROJECTS)
  const [projectId, setProjectId] = useState(projects[0].id)
  const current = projects.find((p) => p.id === projectId) ?? projects[0]

  // ── 需求 / 看板 ──
  const [requirements, setRequirements] = useState<Requirement[]>(REQUIREMENTS)
  const [columns, setColumns] = useState<KanbanColumn[]>(KANBAN_COLUMNS)

  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newRequirementOpen, setNewRequirementOpen] = useState(false)

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

  const handleCreateRequirement = (data: { title: string; priority: "P0" | "P1" | "P2" }) => {
    const req: Requirement = {
      id: nextId(requirements, "REQ-"),
      title: data.title,
      statusBadge: { label: "待排期", tone: "orange" },
      owner: null,
      progressPct: 0,
    }
    setRequirements((prev) => [req, ...prev])
  }

  const handleCreateTask = (task: KanbanTask) => {
    setColumns((prev) =>
      prev.map((c) => (c.key === task.column ? { ...c, tasks: [task, ...c.tasks] } : c)),
    )
  }

  if (me === null) return null // 未完成身份检查前不渲染任何受保护内容

  return (
    <ThemeProvider defaultMode="dark">
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TopBar
          projects={projects}
          currentProjectId={projectId}
          onSwitchProject={setProjectId}
          onOpenNewProject={() => setNewProjectOpen(true)}
          me={me}
          onLogout={() => void logout()}
          onOpenUserManagement={me.user.role === "admin" ? () => setUserPaneOpen(true) : undefined}
        />

        <ProjectStrip
          summary={current}
          onOpenKanban={() => setDrawer("tasks")}
          onOpenRequirements={() => setDrawer("reqs")}
          onOpenNewRequirement={() => setNewRequirementOpen(true)}
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

        <ModulePaneModal
          open={userPaneOpen}
          title="用户管理"
          entry={usersViewEntry}
          onClose={() => setUserPaneOpen(false)}
        />

        <KanbanDrawer
          open={drawer === "tasks"}
          onClose={() => setDrawer(null)}
          columns={columns}
          onCreateTask={handleCreateTask}
        />
        <RequirementsDrawer
          open={drawer === "reqs"}
          onClose={() => setDrawer(null)}
          requirements={requirements}
        />

        <NewProjectModal
          open={newProjectOpen}
          onClose={() => setNewProjectOpen(false)}
          onCreate={handleCreateProject}
        />
        <NewRequirementModal
          open={newRequirementOpen}
          onClose={() => setNewRequirementOpen(false)}
          onCreate={handleCreateRequirement}
        />
      </div>
    </ThemeProvider>
  )
}
