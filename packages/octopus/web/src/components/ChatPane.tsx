import { useCallback, useEffect, useRef, useState } from "react"
import {
  Button,
  Check,
  ChevronDown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  Spinner,
} from "octopus-ui"
import { FileText, History, Plus, Square } from "octopus-ui"
import type { AgentClient, Artifact, PresetInfo, SessionContextInfo, SessionMeta } from "../lib/types"
import { projectSessions, useChat } from "../lib/use-chat"
import { ChatMessage } from "./ChatMessage"
import { Composer } from "./Composer"
import { QUICK_PROMPTS } from "../lib/datasource"

export interface ChatPaneProps {
  /** 注入自定义 client 便于测试；null 时只读欢迎语 */
  agentClient: AgentClient | null
  /** 当前项目 id（绑定模式下切换项目即切换该项目 PM 会话） */
  projectId?: string
  /** 当前项目工作区路径（PM 会话的 cwd） */
  workspacePath?: string
  onArtifactsChange?: (artifacts: Artifact[]) => void
}

function sessionHeader(): string {
  const d = new Date()
  return `今天 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} 开始 · 会话 #47`
}

const PRESET_STORAGE_KEY = "octopus.agentPreset"

function readStoredPreset(): string | null {
  try {
    return localStorage.getItem(PRESET_STORAGE_KEY)
  } catch {
    return null
  }
}

function storePreset(id: string): void {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, id)
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

export function ChatPane({ agentClient, projectId, workspacePath, onArtifactsChange }: ChatPaneProps) {
  const { messages, status, send, artifacts, pendingQuestion, decideApproval, switchSession, switchProject, newSession } =
    useChat(agentClient, { projectId, workspacePath })
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set())
  const [presets, setPresets] = useState<PresetInfo[]>([])
  const [presetId, setPresetId] = useState<string | null>(() => readStoredPreset())
  const [contextOpen, setContextOpen] = useState(false)
  const [contextInfo, setContextInfo] = useState<SessionContextInfo | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const boundProjectRef = useRef<string | undefined>(projectId)
  const bound = Boolean(projectId && workspacePath)
  const projectList = workspacePath ? projectSessions(sessions, workspacePath) : sessions

  // 项目绑定：项目切换 → 解析/创建该项目 PM 会话并载入
  useEffect(() => {
    if (!agentClient || !projectId || !workspacePath) return
    if (boundProjectRef.current === projectId) return
    boundProjectRef.current = projectId
    void switchProject(projectId, workspacePath, {
      agentPreset: presetId && presets.length > 0 ? presetId : undefined,
    })
  }, [agentClient, projectId, workspacePath, presetId, presets.length, switchProject])

  const refreshSessions = useCallback(async () => {
    if (!agentClient) return
    try {
      const list = (await agentClient.listSessions()).slice(0, 20)
      setSessions(list)
      setCurrentSessionId((prev) => prev ?? list[0]?.id ?? null)
    } catch {
      /* 保留上次列表 */
    }
  }, [agentClient])

  useEffect(() => {
    if (presets.length > 0 || !agentClient) return
    void agentClient.listPresets().then((list) => {
      setPresets(list)
      setPresetId((prev) => prev ?? list[0]?.id ?? null)
    }).catch(() => undefined)
  }, [agentClient, presets.length])

  const selectedPreset = presets.find((p) => p.id === presetId) ?? null

  const handleOpenContext = async () => {
    setContextOpen(true)
    if (!agentClient || !currentSessionId) return
    try {
      setContextInfo(await agentClient.getSessionContext(currentSessionId))
    } catch {
      setContextInfo({ live: false })
    }
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, status])

  useEffect(() => {
    onArtifactsChange?.(artifacts)
  }, [artifacts, onArtifactsChange])

  const handleOpenSessions = (open: boolean) => {
    setSessionsOpen(open)
    if (open) void refreshSessions()
  }

  const handleNewSession = async () => {
    try {
      const id = await newSession({
        agentPreset: presetId && presets.length > 0 ? presetId : undefined,
      })
      setCurrentSessionId(id)
    } catch {
      /* 保持当前会话 */
    }
  }

  const handleSwitchSession = (id: string) => {
    setCurrentSessionId(id)
    void switchSession(id)
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* 滚动区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] space-y-5 px-6 pb-2 pt-6">
          {/* 会话头 */}
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2 text-xs text-text-faint">
              <History className="h-3.5 w-3.5" />
              {sessionHeader()}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                title="查看上下文"
                disabled={!agentClient}
                data-testid="context-viewer"
                onClick={() => void handleOpenContext()}
              >
                <FileText className="h-3.5 w-3.5" />
                上下文
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    disabled={!agentClient}
                    title="Agent 预设"
                    data-testid="preset-switcher"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    预设：{selectedPreset?.name ?? selectedPreset?.id ?? "未设置"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px]">
                  {presets.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      data-testid={`preset-option-${p.id}`}
                      onSelect={() => {
                        setPresetId(p.id)
                        storePreset(p.id)
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px]">{p.name ?? p.id}</span>
                      {p.id === presetId && <Check className="h-4 w-4 shrink-0 text-accent" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu open={sessionsOpen} onOpenChange={handleOpenSessions}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  disabled={!agentClient}
                  data-testid="session-switcher"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  会话
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[260px]">
                {!bound && (
                  <DropdownMenuItem data-testid="session-new" onSelect={() => void handleNewSession()}>
                    <Plus className="h-4 w-4" />
                    新建会话
                  </DropdownMenuItem>
                )}
                {!bound && <DropdownMenuSeparator />}
                {projectList.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => handleSwitchSession(s.id)}>
                    {s.live && (
                      <span
                        data-testid={`session-live-${s.id}`}
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        aria-label="live"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13px]">{s.title ?? s.id}</span>
                    {s.id.startsWith("task-") && (
                      <span
                        data-testid={`session-task-${s.id}`}
                        className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground"
                      >
                        任务
                      </span>
                    )}
                    {s.id === currentSessionId && (
                      <Check data-testid={`session-current-${s.id}`} className="h-4 w-4 shrink-0 text-accent" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          </div>

          {messages.map((m) => (
            <ChatMessage
              key={m.id}
              message={m}
              decidedApprovalIds={decidedIds}
              onApprovalDecision={(id, decision) => {
                setDecidedIds((prev) => new Set(prev).add(id))
                decideApproval(id, decision)
              }}
            />
          ))}

          {status === "thinking" && (
            <div className="flex items-center gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
                <Spinner size="sm" />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                data-testid="stop-thinking"
                onClick={() => void agentClient?.cancel()}
              >
                <Square className="h-3 w-3" />
                停止思考
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 pb-5">
        <div className="mx-auto max-w-[820px] px-6">
          {pendingQuestion && (
            <div
              title="pending-question"
              className="mb-2 flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-muted-foreground"
            >
              <span className="shrink-0 font-medium text-foreground">Agent 提问：</span>
              <span className="truncate">{pendingQuestion.question}</span>
            </div>
          )}
          <Composer
            quickPrompts={QUICK_PROMPTS}
            disabled={agentClient === null || status === "thinking"}
            contextLabel="Octopus Platform"
            onSend={send}
          />
        </div>
      </div>

      <Sheet open={contextOpen} onOpenChange={(open) => { setContextOpen(open); if (!open) setContextInfo(null) }} title="会话上下文" subtitle={currentSessionId ?? undefined}>
        {contextInfo === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" />
            正在读取会话上下文…
          </div>
        ) : contextInfo.live === false ? (
          <div className="text-sm text-muted-foreground">会话未激活，无法读取上下文。</div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">
                模型：<span className="font-mono text-foreground">{contextInfo.provider ?? "-"} / {contextInfo.model ?? "-"}</span>
              </span>
              <span className="text-muted-foreground">
                最大输出：<span className="font-mono text-foreground">{contextInfo.maxTokens ?? "-"}</span>
              </span>
            </div>
            <section data-testid="context-prompt">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">系统提示词</h3>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                {contextInfo.prompt ?? "（暂无）"}
              </pre>
            </section>
            <section data-testid="context-runtime">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">运行时上下文</h3>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                {contextInfo.context ?? "（暂无）"}
              </pre>
            </section>
          </div>
        )}
      </Sheet>
    </main>
  )
}
