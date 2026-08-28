import type { AgentStreamEvent } from "./types.js"

type WithoutIdx<T> = T extends unknown ? Omit<T, "idx"> : never
type EventInput = WithoutIdx<AgentStreamEvent>

export class EventIndex {
  private events: AgentStreamEvent[] = []

  append(event: EventInput): number {
    const idx = this.events.length
    this.events.push({ ...event, idx } as AgentStreamEvent)
    return idx
  }

  appendAll(events: EventInput[]): number {
    if (this.events.length > 0) throw new Error("EventIndex: appendAll requires an empty index")
    for (const event of events) this.append(event)
    return this.lastIdx
  }

  list(startIdx = 0): AgentStreamEvent[] {
    if (startIdx < 0 || startIdx > this.events.length) return []
    return this.events.slice(startIdx)
  }

  get lastIdx(): number {
    return this.events.length - 1
  }

  get size(): number {
    return this.events.length
  }
}
