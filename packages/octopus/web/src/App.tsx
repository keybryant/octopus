import { useEffect, useMemo, useState } from "react"
import { Button, ThemeProvider } from "octopus-ui"
import { FolderOpen, Plus } from "octopus-ui"
import { createProject, deleteProject, fetchConfig, fetchModules, fetchProjects, updateProject, type ProjectRecordView, type WorkbenchConfig, type WorkbenchModuleInfo } from "./api"
import { ArtifactsRail } from "./components/ArtifactsRail"
import { ChatPane } from "./components/ChatPane"
import { KanbanDrawer } from "./components/KanbanDrawer"
import { ModulesDrawer } from "./components/ModulesDrawer"
import { ModulePaneModal } from "./components/ModulePaneModal"
import { NewProjectModal } from "./components/NewProjectModal"
import { ProjectSettingsModal, type SettingsProject } from "./components/ProjectSettingsModal"
import { ProjectStrip } from "./components/ProjectStrip"
import { TopBar } from "./components/TopBar"
import {
  createDefaultAgentClient,
  KANBAN_COLUMNS,
} from "./lib/datasource"
import { fetchMe, logout, redirectToLogin, type MeResponse } from "./lib/auth"
import { deriveShortName } from "./lib/short-name"
import type {
  Artifact,
  KanbanColumn,
  KanbanTask,
  ProjectSummary,
} from "./lib/types"

type DrawerKind = "tasks" | "modules" | null

function toSummary(p: ProjectRecordView): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    shortName: deriveShortName(p.name),
    description: p.description || "暂无描述",
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

  // ── 项目域状态（插件 API 可用时接管；否则 mock 数据源 + 本会话新增）──
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string | undefined>(undefined)
  const [records, setRecords] = useState<Record<string, ProjectRecordView>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const current = projects.find((p) => p.id === projectId) ?? projects[0]

  useEffect(() => {
    void fetchProjects().then((items) => {
      const list = items ?? []
      const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setRecords(Object.fromEntries(sorted.map((p) => [p.id, p])))
      setProjects(sorted.map(toSummary))
      setProjectId(sorted[0]?.id)
    })
  }, [])

  // ── 看板 ──
  const [columns, setColumns] = useState<KanbanColumn[]>(KANBAN_COLUMNS)

  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const onArtifactsChange = useMemo(() => (a: Artifact[]) => setArtifacts(a), [])

  const agentClient = useMemo(createDefaultAgentClient, [])

  const handleCreateProject = async (data: { name: string; description: string }) => {
    const created = await createProject({ name: data.name, description: data.description })
    if (!created) {
      console.warn("[octopus] 创建项目失败")
      return
    }
    setRecords((prev) => ({ ...prev, [created.id]: created }))
    setProjects((prev) => [...prev, toSummary(created)])
    setProjectId(created.id)
  }

  // ── 项目设置弹窗（仅 API 模式有真实记录可编辑）──
  const settingsTarget: SettingsProject | null = (() => {
    if (!projectId) return null
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
    if (!settingsTarget) return false
    const ok = await updateProject(settingsTarget.id, data)
    if (!ok) return false
    setRecords((prev) => ({ ...prev, [settingsTarget.id]: { ...prev[settingsTarget.id], ...data } }))
    setProjects((prev) =>
      prev.map((p) => (p.id === settingsTarget.id ? { ...p, description: data.description || "暂无描述" } : p)),
    )
    return true
  }

  const handleDeleteSettings = async () => {
    if (!settingsTarget) return false
    const ok = await deleteProject(settingsTarget.id)
    if (!ok) return false
    const restRecords = { ...records }
    delete restRecords[settingsTarget.id]
    setRecords(restRecords)
    const rest = projects.filter((p) => p.id !== settingsTarget.id)
    setProjects(rest)
    setProjectId(rest[0]?.id)
    if (rest.length === 0) setDrawer(null)
    return true
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
          onOpenProjectSettings={() => setSettingsOpen(true)}
          me={me}
          onLogout={() => void logout()}
          onOpenUserManagement={me.user.role === "admin" ? () => setUserPaneOpen(true) : undefined}
        />

        {current ? (
          <>
            <ProjectStrip
              summary={current}
              onOpenKanban={() => setDrawer("tasks")}
              onOpenModules={() => setDrawer("modules")}
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
            <ModulesDrawer
              open={drawer === "modules"}
              onClose={() => setDrawer(null)}
              modules={modules}
            />
            <ProjectSettingsModal
              open={settingsOpen && settingsTarget !== null}
              onClose={() => setSettingsOpen(false)}
              project={settingsTarget}
              onSave={handleSaveSettings}
              onDelete={handleDeleteSettings}
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border-strong bg-surface-hover">
              <FolderOpen className="h-6 w-6 text-accent" />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-semibold text-foreground">暂无项目</p>
              <p className="mt-1 text-[13px] text-muted-foreground">从顶部切换器新建项目，开始协作</p>
            </div>
            <Button variant="primary" size="sm" onClick={() => setNewProjectOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              新建项目
            </Button>
          </div>
        )}

        <ModulePaneModal
          open={userPaneOpen}
          title="用户管理"
          entry={usersViewEntry}
          onClose={() => setUserPaneOpen(false)}
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
