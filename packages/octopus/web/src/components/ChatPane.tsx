import { useEffect, useMemo, useRef } from "react"
import { Button, Spinner } from "octopus-ui"
import { History } from "octopus-ui"
import { createDefaultAgentClient } from "../lib/datasource"
import type { AgentClient } from "../lib/types"
import { useChat } from "../lib/use-chat"
import { ChatMessage } from "./ChatMessage"
import { Composer } from "./Composer"
import { QUICK_PROMPTS } from "../lib/datasource"

export interface ChatPaneProps {
  /** 注入自定义 client 便于测试；生产默认 mock */
  agentClient?: AgentClient
  onArtifactsChange?: (artifacts: ReturnType<typeof useChat>["artifacts"]) => void
}

function sessionHeader(): string {
  const d = new Date()
  return `今天 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} 开始 · 会话 #47`
}

export function ChatPane({ agentClient, onArtifactsChange }: ChatPaneProps) {
  const client = useMemo(() => agentClient ?? createDefaultAgentClient(), [agentClient])
  const { messages, status, send, artifacts } = useChat(client)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, status])

  useEffect(() => {
    onArtifactsChange?.(artifacts)
  }, [artifacts, onArtifactsChange])

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
            <Button variant="ghost" size="sm" className="text-xs">
              历史会话
            </Button>
          </div>

          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
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
          <Composer quickPrompts={QUICK_PROMPTS} disabled={status === "thinking"} contextLabel="Octopus Platform · 迭代 4.2" onSend={send} />
        </div>
      </div>
    </main>
  )
}
