import type { TaskSessionEvent } from "./types.js"

export interface SessionEventLike {
  seq: number
  type: string
  data: Record<string, unknown>
}

export interface ProjectState { callNames: Map<string, string> }
export function createProjectState(): ProjectState { return { callNames: new Map() } }

export const EVENT_BUFFER_MAX = 100
export const EVENT_TAIL = 15

const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)

function blockSummary(block: { arguments?: unknown }): string {
  const raw = typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments ?? {})
  return clamp(raw, 160)
}

function reasonText(reason: unknown): string {
  if (typeof reason === "string") return reason
  if (typeof reason === "object" && reason !== null && typeof (reason as { kind?: unknown }).kind === "string") {
    return (reason as { kind: string }).kind
  }
  return JSON.stringify(reason)
}

/** 单个原始会话事件 → 任务会话事件投影（纯函数；assistant/message 逐块产出多条） */
export function projectEvents(st: ProjectState, raw: SessionEventLike): TaskSessionEvent[] {
  const d = raw.data
  switch (raw.type) {
    case "user/message": {
      if ((d.source as { kind?: unknown } | undefined)?.kind === "plugin") return []
      let text = ""
      if (typeof d.text === "string") text = d.text
      else if (Array.isArray(d.content)) {
        const first = d.content[0]
        if (typeof first === "object" && first !== null && typeof (first as { text?: unknown }).text === "string") {
          text = (first as { text: string }).text
        }
      }
      return [{ type: "user-message", text }]
    }
    case "assistant/message": {
      const message = d.message as { content?: unknown } | undefined
      const content = message?.content
      if (!Array.isArray(content)) return []
      const out: TaskSessionEvent[] = []
      for (const block of content) {
        if (typeof block !== "object" || block === null) continue
        const b = block as { type?: unknown }
        if (b.type === "text" && typeof (block as { text?: unknown }).text === "string") {
          out.push({ type: "assistant-text", text: (block as { text: string }).text })
        } else if (b.type === "tool-call") {
          const call = block as { id?: unknown; name?: unknown; arguments?: unknown }
          const id = String(call.id ?? "")
          const name = String(call.name ?? "tool")
          st.callNames.set(id, name)
          out.push({ type: "tool-call", name, summary: blockSummary(call) })
        }
      }
      return out
    }
    case "turn/start":
      return [{ type: "turn", at: "start" }]
    case "turn/end": {
      const out: TaskSessionEvent = { type: "turn", at: "end" }
      if (d.reason !== undefined) out.reason = reasonText(d.reason)
      return [out]
    }
    case "tool/result": {
      const content = (d.message as { content?: unknown } | undefined)?.content
      const first = Array.isArray(content) ? content[0] : undefined
      const block = first && typeof first === "object"
        ? first as { toolCallId?: unknown; content?: unknown }
        : undefined
      const callId = String(block?.toolCallId ?? "")
      return [{
        type: "tool-result",
        name: st.callNames.get(callId) ?? "tool",
        ok: d.error === undefined,
        preview: clamp(JSON.stringify(block?.content ?? []), 200),
      }]
    }
    default:
      return []
  }
}

/** 环形缓冲追加（超限裁剪头部，纯函数返回新数组） */
export function appendEvent<T>(buffer: T[], event: T, max = EVENT_BUFFER_MAX): T[] {
  const next = [...buffer, event]
  return next.length > max ? next.slice(next.length - max) : next
}

/** 取缓冲尾部 n 条摘要 */
export function tailEvents<T>(buffer: T[], n = EVENT_TAIL): T[] {
  return buffer.slice(Math.max(0, buffer.length - n))
}
