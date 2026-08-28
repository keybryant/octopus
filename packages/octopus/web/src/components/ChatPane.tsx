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
  Spinner,
} from "octopus-ui"
import { History, Plus } from "octopus-ui"
import type { AgentClient, Artifact, SessionMeta } from "../lib/types"
import { useChat } from "../lib/use-chat"
import { ChatMessage } from "./ChatMessage"
import { Composer } from "./Composer"
import { QUICK_PROMPTS } from "../lib/datasource"

export interface ChatPaneProps {
  /** 注入自定义 client 便于测试；null 时只读欢迎语 */
  agentClient: AgentClient | null
  /** 新建会话的工作目录 */
  currentCwd?: string
  onArtifactsChange?: (artifacts: Artifact[]) => void
}

function sessionHeader(): string {
  const d = new Date()
  return `今天 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} 开始 · 会话 #47`
}

export function ChatPane({ agentClient, currentCwd, onArtifactsChange }: ChatPaneProps) {
  const { messages, status, send, artifacts, pendingQuestion, decideApproval, switchSession, newSession } =
    useChat(agentClient)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

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
      const id = await newSession({ cwd: currentCwd })
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
                <DropdownMenuItem data-testid="session-new" onSelect={() => void handleNewSession()}>
                  <Plus className="h-4 w-4" />
                  新建会话
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {sessions.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => handleSwitchSession(s.id)}>
                    {s.live && (
                      <span
                        data-testid={`session-live-${s.id}`}
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        aria-label="live"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13px]">{s.title ?? s.id}</span>
                    {s.id === currentSessionId && (
                      <Check data-testid={`session-current-${s.id}`} className="h-4 w-4 shrink-0 text-accent" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
                <Spinner size="sm" />
              </div>
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
    </main>
  )
}
