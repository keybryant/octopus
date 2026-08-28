import type { AgentStreamEvent } from "./types.js"

export interface SessionEventLike {
  seq: number
  time: number
  type: string
  data: Record<string, unknown>
}

export interface ProjectState { callNames: Map<string, string> }
export function createProjectState(): ProjectState { return { callNames: new Map() } }

export interface CapturedEvent {
  sourceSeq: number
  type: "user-message" | "assistant-text" | "tool-call" | "tool-result" | "turn-start" | "turn-end" | "approval"
  payload: Record<string, unknown>
}

const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)

function blockSummary(block: { arguments?: unknown }): string {
  const raw = typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments ?? {})
  return clamp(raw, 160)
}

function projectMessage(st: ProjectState, data: Record<string, unknown>, seq: number): CapturedEvent[] {
  const message = data.message as { content?: unknown } | undefined
  const content = message?.content
  if (!Array.isArray(content)) return []
  const out: CapturedEvent[] = []
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue
    const b = block as { type?: unknown }
    if (b.type === "text" && typeof (block as { text?: unknown }).text === "string") {
      out.push({ sourceSeq: seq, type: "assistant-text", payload: { text: (block as { text: string }).text } })
    } else if (b.type === "tool-call") {
      const call = block as { id?: unknown; name?: unknown; arguments?: unknown }
      const id = String(call.id ?? "")
      const name = String(call.name ?? "tool")
      st.callNames.set(id, name)
      out.push({ sourceSeq: seq, type: "tool-call", payload: { callId: id, name, summary: blockSummary(call) } })
    }
  }
  return out
}

export function projectEvents(st: ProjectState, ev: SessionEventLike): CapturedEvent[] {
  const d = ev.data
  switch (ev.type) {
    case "user/message": {
      let text = ""
      if (typeof d.text === "string") text = d.text
      else if (Array.isArray(d.content)) {
        const first = d.content[0]
        if (typeof first === "object" && first !== null && typeof (first as { text?: unknown }).text === "string") {
          text = (first as { text: string }).text
        }
      }
      return [{ sourceSeq: ev.seq, type: "user-message", payload: { text } }]
    }
    case "turn/start": return [{ sourceSeq: ev.seq, type: "turn-start", payload: {} }]
    case "turn/end": {
      const payload: Record<string, unknown> = {}
      if (d.reason !== undefined) payload.reason = String(d.reason)
      return [{ sourceSeq: ev.seq, type: "turn-end", payload }]
    }
    case "approval/asked": {
      const payload: Record<string, unknown> = {
        id: String(d.id ?? "unknown"),
        toolName: String(d.toolName ?? "tool"),
      }
      if (typeof d.reason === "string") payload.reason = d.reason
      return [{ sourceSeq: ev.seq, type: "approval", payload }]
    }
    case "assistant/message": {
      return projectMessage(st, d, ev.seq)
    }
    case "tool/result": {
      const content = (d.message as { content?: unknown } | undefined)?.content
      const first = Array.isArray(content) ? content[0] : undefined
      const block = first && typeof first === "object" ? first as { toolCallId?: unknown; content?: unknown } : undefined
      const callId = String(block?.toolCallId ?? "")
      const preview = clamp(JSON.stringify(block?.content ?? []), 200)
      return [{
        sourceSeq: ev.seq,
        type: "tool-result",
        payload: { callId, name: st.callNames.get(callId) ?? "tool", ok: d.error === undefined, preview },
      }]
    }
    default: return []
  }
}

function stripIdx(e: AgentStreamEvent): Omit<AgentStreamEvent, "idx"> {
  const { idx: _idx, ...rest } = e
  return rest
}

export function toStreamEvent(ev: CapturedEvent): Omit<AgentStreamEvent, "idx"> {
  switch (ev.type) {
    case "user-message": return stripIdx({ idx: 0, type: "user-message", text: ev.payload.text as string })
    case "assistant-text": return stripIdx({ idx: 0, type: "assistant-text", text: ev.payload.text as string })
    case "tool-call": return stripIdx({ idx: 0, type: "tool-call", callId: ev.payload.callId as string, name: ev.payload.name as string, summary: ev.payload.summary as string })
    case "tool-result": return stripIdx({ idx: 0, type: "tool-result", callId: ev.payload.callId as string, name: ev.payload.name as string, ok: ev.payload.ok as boolean, preview: ev.payload.preview as string })
    case "turn-start": return stripIdx({ idx: 0, type: "turn", at: "start" })
    case "turn-end": return stripIdx({ idx: 0, type: "turn", at: "end", reason: ev.payload.reason as string | undefined })
    case "approval": return stripIdx({ idx: 0, type: "approval", id: ev.payload.id as string, toolName: ev.payload.toolName as string, reason: ev.payload.reason as string | undefined })
  }
}

export function deriveTitle(events: CapturedEvent[]): string | null {
  const first = events.find((e) => e.type === "user-message")
  if (!first) return null
  const text = (first.payload.text as string).trim().replace(/\s+/g, " ")
  return text.length === 0 ? null : clamp(text, 30)
}
