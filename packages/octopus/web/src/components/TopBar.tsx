import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "octopus-ui"
import { Check, ChevronDown, Plus, Search, Settings } from "octopus-ui"
import type { MeResponse } from "../lib/auth"
import type { ProjectSummary } from "../lib/types"
import { OctoLogo } from "./OctoLogo"

export interface TopBarProps {
  projects: ProjectSummary[]
  currentProjectId: string
  onSwitchProject: (id: string) => void
  onOpenNewProject: () => void
  me: MeResponse
  onLogout: () => void
  onOpenUserManagement?: () => void
}

const iconBtn =
  "p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors duration-fast"

const roleLabel: Record<MeResponse["user"]["role"], string> = {
  admin: "管理员",
  user: "普通用户",
}

export function TopBar({
  projects,
  currentProjectId,
  onSwitchProject,
  onOpenNewProject,
  me,
  onLogout,
  onOpenUserManagement,
}: TopBarProps) {
  const current = projects.find((p) => p.id === currentProjectId) ?? projects[0]

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-background px-5">
      <OctoLogo className="h-6 w-6 text-accent" />

      <div className="h-5 w-px bg-border" />

      {/* 项目切换 */}
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="project-switcher"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors duration-fast hover:bg-surface"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border-strong bg-surface-hover font-mono text-[10px] text-muted-foreground">
            {current.shortName}
          </span>
          <span className="text-sm font-semibold">{current.name}</span>
          <ChevronDown className="h-3.5 w-3.5 text-text-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[320px]">
          <div className="border-b border-border p-3 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
              <input
                placeholder="切换项目…"
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] placeholder:text-text-faint focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <DropdownMenuLabel>最近项目</DropdownMenuLabel>
          {projects.map((p) => {
            const isCurrent = p.id === current.id
            return (
              <DropdownMenuItem key={p.id} onSelect={() => onSwitchProject(p.id)}>
                <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border-strong bg-surface-hover font-mono text-[10px] text-muted-foreground">
                  {p.shortName}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.name}</span>
                  <span className="block truncate text-[11px] text-text-faint">
                    {p.description.split(" · ")[0]} · {p.iteration.split(" · ")[0]}
                  </span>
                </span>
                {isCurrent && <Check className="h-4 w-4 text-accent" />}
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenNewProject}>
            <Plus className="h-4 w-4" />
            新建项目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Badge tone="success">{current.iteration}</Badge>

      <span className="flex-1" />

      {/* 设置 */}
      <DropdownMenu>
        <DropdownMenuTrigger title="设置" className={iconBtn} aria-label="设置">
          <Settings className="h-[18px] w-[18px]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[240px]">
          <DropdownMenuLabel>本项目</DropdownMenuLabel>
          <DropdownMenuItem>项目设置</DropdownMenuItem>
          <DropdownMenuItem>成员与权限</DropdownMenuItem>
          <DropdownMenuItem>仓库与集成</DropdownMenuItem>
          <DropdownMenuItem>自动化规则</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>全局</DropdownMenuLabel>
          <DropdownMenuItem>工作区偏好</DropdownMenuItem>
          <DropdownMenuItem>通知设置</DropdownMenuItem>
          {onOpenUserManagement && (
            <DropdownMenuItem onSelect={onOpenUserManagement}>用户管理</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <a href="/" className="block px-4 py-2 text-[13px] text-muted-foreground hover:text-accent">
            进入主界面
          </a>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 用户 */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="用户菜单"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-info/15 text-[11px] font-medium text-info transition-shadow hover:ring-2 hover:ring-border-strong"
        >
          {me.user.username.slice(0, 2).toUpperCase()}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]">
          <div className="border-b border-border px-4 pb-2.5 pt-3">
            <div className="text-[13px] font-medium">{me.user.username}</div>
            <div className="text-[11px] text-text-faint">{roleLabel[me.user.role]}</div>
          </div>
          <div className="py-1.5">
            <DropdownMenuItem>个人资料</DropdownMenuItem>
            <DropdownMenuItem>API Token</DropdownMenuItem>
          </div>
          {me.canLogout && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onLogout}>退出</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
