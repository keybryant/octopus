import { useState } from "react"
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "octopus-ui"
import { Bell, Check, ChevronDown, Plus, Search, Settings, Blocks } from "octopus-ui"
import type { ProjectSummary } from "../lib/types"
import { OctoLogo } from "./OctoLogo"

export interface TopBarProps {
  projects: ProjectSummary[]
  currentProjectId: string
  onSwitchProject: (id: string) => void
  onOpenModules: () => void
}

const iconBtn =
  "p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors duration-fast"

export function TopBar({ projects, currentProjectId, onSwitchProject, onOpenModules }: TopBarProps) {
  const current = projects.find((p) => p.id === currentProjectId) ?? projects[0]
  const [query, setQuery] = useState("")

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
          <DropdownMenuItem>
            <Plus className="h-4 w-4" />
            新建项目
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Badge tone="success">{current.iteration}</Badge>

      <span className="flex-1" />

      {/* 项目内搜索 */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="在项目内搜索…"
          className="h-9 w-60 rounded-lg border border-border bg-surface pl-9 pr-12 text-[13px] placeholder:text-text-faint transition-colors focus:border-accent focus:outline-none"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-faint">
          ⌘K
        </span>
      </div>

      {/* 已装模块 */}
      <Button variant="ghost" size="sm" onClick={onOpenModules} title="已装模块" aria-label="已装模块" className={iconBtn}>
        <Blocks className="h-4 w-4" />
      </Button>

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
          <DropdownMenuSeparator />
          <a href="/" className="block px-4 py-2 text-[13px] text-muted-foreground hover:text-accent">
            进入主界面
          </a>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 通知 */}
      <button className={`relative ${iconBtn}`} aria-label="通知">
        <Bell className="h-[18px] w-[18px]" />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warn" />
      </button>

      {/* 用户 */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="用户菜单"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-info/15 text-[11px] font-medium text-info transition-shadow hover:ring-2 hover:ring-border-strong"
        >
          YL
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]">
          <div className="border-b border-border px-4 pb-2.5 pt-3">
            <div className="text-[13px] font-medium">Yuan Liu</div>
            <div className="text-[11px] text-text-faint">yuan@octopus.dev · 管理员</div>
          </div>
          <div className="py-1.5">
            <DropdownMenuItem>个人资料</DropdownMenuItem>
            <DropdownMenuItem>API Token</DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
