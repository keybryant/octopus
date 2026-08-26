import { useEffect, useMemo, useState } from "react"
import { ThemeProvider } from "octopus-ui"
import { createProject, deleteProject, fetchConfig, fetchProjects, updateProject, type ProjectRecordView, type WorkbenchConfig } from "./api"
import { ArtifactsRail } from "./components/ArtifactsRail"
import { ChatPane } from "./components/ChatPane"
import { KanbanDrawer } from "./components/KanbanDrawer"
import { NewProjectModal } from "./components/NewProjectModal"
import { NewRequirementModal } from "./components/NewRequirementModal"
import { ProjectSettingsModal, type SettingsProject } from "./components/ProjectSettingsModal"
import { ProjectStrip } from "./components/ProjectStrip"
import { RequirementsDrawer } from "./components/RequirementsDrawer"
import { TopBar } from "./components/TopBar"
import {
  createDefaultAgentClient,
  KANBAN_COLUMNS,
  PROJECTS,
  REQUIREMENTS,
} from "./lib/datasource"
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

function toSummary(p: ProjectRecordView): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    shortName: deriveShortName(p.name),
    description: p.description || "暂无描述",
    iteration: "未排期",
    dueDate: "-",
    progressPct: 0,
    weeklyDone: 0,
    weeklyTotal: 0,
    activeRequirements: 0,
    overdue: 0,
    members: [],
  }
}

export default function App() {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null)
  useEffect(() => {
    void fetchConfig().then(setConfig)
  }, [])

  // ── 项目域状态（插件 API 可用时接管；否则 mock 数据源 + 本会话新增）──
  const [projects, setProjects] = useState<ProjectSummary[]>(PROJECTS)
  const [projectId, setProjectId] = useState(projects[0].id)
  const [records, setRecords] = useState<Record<string, ProjectRecordView>>({})
  const [usingApi, setUsingApi] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const current = projects.find((p) => p.id === projectId) ?? projects[0]

  useEffect(() => {
    void fetchProjects().then((items) => {
      if (!items || items.length === 0) return // 服务不在或空 → 保持 mock
      setUsingApi(true)
      const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setRecords(Object.fromEntries(sorted.map((p) => [p.id, p])))
      setProjects(sorted.map(toSummary))
      setProjectId(sorted[0].id)
    })
  }, [])

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

  const handleCreateProject = async (data: { name: string; description: string }) => {
    if (usingApi) {
      const created = await createProject({ name: data.name, description: data.description })
      if (!created) {
        console.warn("[octopus] 创建项目失败")
        return
      }
      setRecords((prev) => ({ ...prev, [created.id]: created }))
      setProjects((prev) => [...prev, toSummary(created)])
      setProjectId(created.id)
      return
    }
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

  // ── 项目设置弹窗（仅 API 模式有真实记录可编辑）──
  const settingsTarget: SettingsProject | null = (() => {
    const rec = records[projectId]
    if (!rec) return null
    return {
      id: rec.id,
      name: rec.name,
      description: rec.description,
      status: rec.status,
      workspacePath: rec.workspacePath,
      createdAt: rec.createdAt,
    }
  })()

  const handleSaveSettings = async (data: { description: string; status: SettingsProject["status"] }) => {
    if (!usingApi || !settingsTarget) return false
    const ok = await updateProject(settingsTarget.id, data)
    if (!ok) return false
    setRecords((prev) => ({ ...prev, [settingsTarget.id]: { ...prev[settingsTarget.id], ...data } }))
    setProjects((prev) =>
      prev.map((p) => (p.id === settingsTarget.id ? { ...p, description: data.description || "暂无描述" } : p)),
    )
    return true
  }

  const handleDeleteSettings = async () => {
    if (!usingApi || !settingsTarget) return false
    const ok = await deleteProject(settingsTarget.id)
    if (!ok) return false
    const restRecords = { ...records }
    delete restRecords[settingsTarget.id]
    setRecords(restRecords)
    const rest = projects.filter((p) => p.id !== settingsTarget.id)
    const next = rest.length > 0 ? rest : PROJECTS // 删空回落 mock（与列表策略一致）
    setProjects(next)
    setProjectId(next[0].id)
    return true
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

  return (
    <ThemeProvider defaultMode="dark">
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TopBar
          projects={projects}
          currentProjectId={projectId}
          onSwitchProject={setProjectId}
          onOpenNewProject={() => setNewProjectOpen(true)}
          onOpenProjectSettings={() => setSettingsOpen(true)}
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
        <ProjectSettingsModal
          open={settingsOpen && settingsTarget !== null}
          onClose={() => setSettingsOpen(false)}
          project={settingsTarget}
          onSave={handleSaveSettings}
          onDelete={handleDeleteSettings}
        />
      </div>
    </ThemeProvider>
  )
}
