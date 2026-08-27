import { useCallback, useRef, useState } from "react"
import { timeGreeting } from "../greeting"
import { currentProject, INITIAL_ARTIFACTS } from "./datasource"
import type { AgentClient, Artifact, ChatMessage } from "./types"

export type ChatStatus = "idle" | "thinking"

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

function nowHHmm(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function buildWelcome(): ChatMessage {
  const project = currentProject()
  return {
    id: nextId("msg"),
    role: "assistant",
    time: nowHHmm(),
    text: `${timeGreeting(new Date().getHours())}。当前上下文：${project.name}。今天有 2 个任务临近到期，要我先把今天的优先事项列出来，还是直接开始处理某个需求？`,
  }
}

export function useChat(client: AgentClient): {
  messages: ChatMessage[]
  status: ChatStatus
  send: (text: string) => void
  artifacts: Artifact[]
} {
  const [messages, setMessages] = useState<ChatMessage[]>([buildWelcome()])
  const [status, setStatus] = useState<ChatStatus>("idle")
  const [artifacts, setArtifacts] = useState<Artifact[]>(INITIAL_ARTIFACTS)
  const busyRef = useRef(false)

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busyRef.current) return
      busyRef.current = true

      const userMsg: ChatMessage = {
        id: nextId("msg"),
        role: "user",
        time: nowHHmm(),
        text: trimmed,
      }
      setMessages((prev) => [...prev, userMsg])
      setStatus("thinking")

      const startedAt = Date.now()
      const finalize = () => {
        setStatus("idle")
        busyRef.current = false
      }
      void client
        .reply(trimmed)
        .then((reply) => {
          const elapsedMs = Date.now() - startedAt
          const assistantMsg: ChatMessage = {
            id: nextId("msg"),
            role: "assistant",
            time: nowHHmm(),
            blocks: reply.blocks,
            meta: `${nowHHmm()} · gpt-4 · ${(elapsedMs / 1000).toFixed(1)}s`,
          }
          setMessages((prev) => [...prev, assistantMsg])
          if (reply.artifacts?.length) {
            setArtifacts((prev) => {
              const seen = new Set(prev.map((a) => a.id))
              const fresh = reply.artifacts!.filter((a) => !seen.has(a.id))
              return [...prev, ...fresh]
            })
          }
          finalize()
        })
        .catch(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId("msg"),
              role: "assistant",
              time: nowHHmm(),
              text: "抱歉，这次请求失败了，请稍后重试。",
            },
          ])
          finalize()
        })
    },
    [client],
  )

  return { messages, status, send, artifacts }
}
