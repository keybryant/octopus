export type AgentPresetLike = string
export interface SessionMeta { id: string; createdAt: string; cwd: string | null; title: string | null; live: boolean }
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
export interface PresetInfo { id: string; name?: string; description?: string }
