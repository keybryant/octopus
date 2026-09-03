export type AgentPresetLike = string
export interface SessionMeta {
  id: string
  createdAt: string
  cwd: string | null
  title: string | null
  live: boolean
  /** 会话创建时使用的 agent 预设（dsh 会话头持久化字段；非 live 会话从快照头读取） */
  agentPreset?: string
}
export type AgentStreamEvent = { idx: number } & (
  | { type: "status"; status: "idle" | "running" }
  | { type: "user-message"; text: string }
  | { type: "assistant-text"; text: string }
  | { type: "tool-call"; callId: string; name: string; summary: string }
  | { type: "tool-result"; callId: string; name: string; ok: boolean; preview: string }
  | { type: "turn"; at: "start" | "end"; reason?: string }
  | { type: "question"; id: string; question: string; options?: string[] }
  | { type: "approval"; id: string; toolName: string; reason?: string }
  | { type: "error"; message: string }
)
export interface CreateSessionInput {
  cwd?: string
  agentPreset?: string
  provider?: string
  model?: string
}
export interface PresetInfo {
  id: string
  name?: string
  description?: string
  /** 该智能体预设单独指定的模型（未指定时为 undefined，用平台默认） */
  provider?: string
  model?: string
}
export interface SessionContextInfo {
  live: boolean
  provider?: string
  model?: string
  maxTokens?: number
  prompt?: string
  context?: string
}
