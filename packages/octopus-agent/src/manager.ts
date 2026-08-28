import { EventIndex } from "./events-index.js"
import { createProjectState, deriveTitle, projectEvents, toStreamEvent, type SessionEventLike } from "./project.js"
import type { SessionMeta } from "./types.js"

export interface UserMessageLike {
  role: "user"
  content: { type: "text"; text: string }[]
  source: { kind: "user" }
}

export type AgentCancelCause = { readonly kind: "user" }

export interface AgentLike {
  id: string
  status: "idle" | "running"
  ctx: { on(event: string, listener: (...args: unknown[]) => void): unknown }
  followup(message: UserMessageLike): void
  cancel(cause: AgentCancelCause): void
}

export interface AgentHandleLike {
  agent: AgentLike
  dispose(): Promise<void>
}

export interface AgentsLike {
  create(options: {
    sessionId: string
    meta?: { cwd?: string; agentPreset?: string }
    agentOptions?: { provider?: string; model?: string }
  }): Promise<AgentHandleLike>
  resume(options: { resumeSessionId: string; agentOptions?: { provider?: string; model?: string } }): Promise<AgentHandleLike>
}

export interface HistoryLike {
  meta: { cwd: unknown; createdAt: unknown }
  events: unknown[]
}

export interface SnapshotLike {
  header: { id: string; createdAt: unknown; meta?: { cwd?: unknown } }
}

export interface PersistenceLike {
  load(id: string): Promise<HistoryLike>
  listSnapshots(): Promise<SnapshotLike[]>
}

export interface ApprovalLike {
  id: string
  toolName: string
  reason?: string
}

export type ApprovalOutcomeLike = "allowed-once" | "rejected" | "cancelled"
export type ApprovalDecision = "allow" | "deny"

export interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

export interface QuestionAnswers {
  answers: QuestionAnswer[]
}

export interface AgentRawApi {}

export interface ManagerDeps {
  agents: AgentsLike
  persistence: PersistenceLike
  sessionIdFactory: () => string
  defaultCwd: string | null
  defaultAgentPreset: string
  provider?: string
  model?: string
  idleTtlMs: number
  systemPromptSection?: (agentRaw: AgentRawApi, text: string) => void
}

export class ManagerError extends Error {
  constructor(
    readonly code: "SESSION_EXISTS" | "SESSION_NOT_FOUND" | "APPROVAL_NOT_FOUND" | "AGENT_LOOP_UNAVAILABLE",
    message: string,
  ) {
    super(message)
  }
}

interface PendingApproval {
  approval: ApprovalLike
  resolve: (outcome: ApprovalOutcomeLike) => void
}

interface PendingQuestion {
  qid: string
  callerItemId: string
  sessionId: string
  resolve(answers: QuestionAnswers): void
}

export interface QuestionItem {
  callerItemId: string
  question: string
  options?: string[]
}

type IndexEventInput = Parameters<EventIndex["append"]>[0]

interface SessionEntry {
  meta: SessionMeta
  handle: AgentHandleLike | null
  index: EventIndex
  pendingApprovals: Map<string, PendingApproval>
  pendingQuestions: Map<string, PendingQuestion>
  lastActivityMs: number
  approvalSeq: number
  questionSeq: number
}

export class AgentManager {
  private entries = new Map<string, SessionEntry>()
  private currentNow = (): number => Date.now()

  constructor(private deps: ManagerDeps) {}

  setNowSource(fn: () => number): void {
    this.currentNow = fn
  }

  private agentOptions(provider?: string, model?: string): { provider?: string; model?: string } {
    const options: { provider?: string; model?: string } = {}
    const resolvedProvider = provider ?? this.deps.provider
    const resolvedModel = model ?? this.deps.model
    if (resolvedProvider !== undefined) options.provider = resolvedProvider
    if (resolvedModel !== undefined) options.model = resolvedModel
    return options
  }

  async create(input: { cwd?: string; agentPreset?: string; provider?: string; model?: string } = {}): Promise<SessionMeta> {
    const id = this.deps.sessionIdFactory()
    if (this.entries.has(id)) throw new ManagerError("SESSION_EXISTS", `session ${id} already exists`)
    const meta: { cwd?: string; agentPreset?: string } = {}
    const cwd = input.cwd ?? this.deps.defaultCwd
    if (typeof cwd === "string") meta.cwd = cwd
    meta.agentPreset = input.agentPreset ?? this.deps.defaultAgentPreset
    let handle: AgentHandleLike
    try {
      handle = await this.deps.agents.create({
        sessionId: id,
        meta,
        agentOptions: this.agentOptions(input.provider, input.model),
      })
    } catch (error) {
      throw new ManagerError("AGENT_LOOP_UNAVAILABLE", `agent create failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    const entry: SessionEntry = {
      meta: { id, createdAt: new Date().toISOString(), cwd: meta.cwd ?? null, title: null, live: true },
      handle,
      index: new EventIndex(),
      pendingApprovals: new Map(),
      pendingQuestions: new Map(),
      lastActivityMs: this.currentNow(),
      approvalSeq: 0,
      questionSeq: 0,
    }
    this.entries.set(id, entry)
    this.listenLive(entry, handle)
    return entry.meta
  }

  async resume(id: string): Promise<SessionMeta> {
    return (await this.ensureLoaded(id)).meta
  }

  private async ensureLoaded(id: string): Promise<SessionEntry> {
    const live = this.entries.get(id)
    if (live?.handle) return live
    let history: HistoryLike
    try {
      history = await this.deps.persistence.load(id)
    } catch {
      throw new ManagerError("SESSION_NOT_FOUND", `session ${id} not found`)
    }
    let handle: AgentHandleLike
    try {
      handle = await this.deps.agents.resume({ resumeSessionId: id, agentOptions: this.agentOptions() })
    } catch (error) {
      throw new ManagerError("AGENT_LOOP_UNAVAILABLE", `resume failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    const st = createProjectState()
    const captured = history.events.flatMap((raw) => projectEvents(st, raw as SessionEventLike))
    const index = new EventIndex()
    index.appendAll(captured.map((item) => toStreamEvent(item) as IndexEventInput))
    const entry: SessionEntry = {
      meta: {
        id,
        createdAt: isoDate(history.meta.createdAt),
        cwd: typeof history.meta.cwd === "string" ? history.meta.cwd : null,
        title: deriveTitle(captured),
        live: true,
      },
      handle,
      index,
      pendingApprovals: new Map(),
      pendingQuestions: new Map(),
      lastActivityMs: this.currentNow(),
      approvalSeq: 0,
      questionSeq: 0,
    }
    this.entries.set(id, entry)
    this.listenLive(entry, handle)
    return entry
  }

  private listenLive(entry: SessionEntry, handle: AgentHandleLike): void {
    const { agent } = handle
    const st = createProjectState()
    const pushStream = (event: IndexEventInput): void => {
      entry.index.append(event)
      entry.lastActivityMs = this.currentNow()
    }
    agent.ctx.on("session/event", (session, event) => {
      if ((session as { id?: string } | undefined)?.id !== entry.meta.id) return
      for (const captured of projectEvents(st, event as SessionEventLike)) {
        pushStream(toStreamEvent(captured) as IndexEventInput)
        if (captured.type === "user-message") entry.meta.title = entry.meta.title ?? deriveTitle([captured])
      }
    })
    agent.ctx.on("agent/status", (payload) => {
      const { status } = payload as { status: "idle" | "running" }
      pushStream({ type: "status", status })
    })
    agent.ctx.on("agent/error", (payload) => {
      const error = (payload as { error?: unknown } | undefined)?.error
      const message = error instanceof Error ? error.message : String(error ?? "agent error")
      pushStream({ type: "error", message })
    })
    agent.ctx.on("approval/request", (req) => {
      const typedReq = req as { toolName?: string; reason?: string } | undefined
      const id = `${entry.meta.id}:a${entry.approvalSeq++}`
      const approval: ApprovalLike = { id, toolName: typedReq?.toolName ?? "tool", reason: typedReq?.reason }
      pushStream({ type: "approval", id: approval.id, toolName: approval.toolName, reason: approval.reason })
      return new Promise<ApprovalOutcomeLike>((resolve) => {
        entry.pendingApprovals.set(id, { approval, resolve })
      })
    })
  }

  async list(): Promise<SessionMeta[]> {
    const ttlMs = this.deps.idleTtlMs
    const now = this.currentNow()
    for (const [id, entry] of [...this.entries]) {
      const handle = entry.handle
      if (handle && ttlMs > 0 && handle.agent.status === "idle" && now - entry.lastActivityMs > ttlMs) {
        this.settlePending(entry)
        await handle.dispose().catch(() => {})
        this.entries.delete(id)
      }
    }
    const metas: SessionMeta[] = (await this.deps.persistence.listSnapshots()).map((snapshot) => this.snapshotMeta(snapshot))
    for (const entry of this.entries.values()) {
      const at = metas.findIndex((meta) => meta.id === entry.meta.id)
      if (at >= 0) metas[at] = entry.meta
      else metas.push(entry.meta)
    }
    return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  private snapshotMeta(snapshot: SnapshotLike): SessionMeta {
    return {
      id: snapshot.header.id,
      createdAt: isoDate(snapshot.header.createdAt),
      cwd: typeof snapshot.header.meta?.cwd === "string" ? snapshot.header.meta.cwd : null,
      title: null,
      live: false,
    }
  }

  getStatus(id: string): { live: boolean; status?: "idle" | "running"; pendingApprovalId?: string } {
    const entry = this.entries.get(id)
    if (!entry?.handle) return { live: false }
    const pending = entry.pendingApprovals.values().next().value
    return { live: true, status: entry.handle.agent.status, pendingApprovalId: pending?.approval.id }
  }

  async getIndex(id: string, opts: { allowResume?: boolean } = {}): Promise<EventIndex> {
    const live = this.entries.get(id)
    if (live?.handle) return live.index
    if (!opts.allowResume) throw new ManagerError("SESSION_NOT_FOUND", `session ${id} not found`)
    return (await this.ensureLoaded(id)).index
  }

  async send(id: string, text: string, answerQuestionId?: string): Promise<void> {
    const entry = this.entries.get(id)
    if (answerQuestionId !== undefined) {
      const pending = entry?.pendingQuestions.get(answerQuestionId)
      if (pending) {
        pending.resolve({ answers: [{ id: pending.callerItemId, selected: [], custom: text }] })
        entry?.pendingQuestions.delete(answerQuestionId)
        if (entry) entry.lastActivityMs = this.currentNow()
        return
      }
    }
    const handle = this.requireLive(id)
    handle.agent.followup({ role: "user", content: [{ type: "text", text }], source: { kind: "user" } })
    if (entry) entry.lastActivityMs = this.currentNow()
  }

  beginQuestion(sessionId: string, item: QuestionItem): { qid: string; answerPromise: Promise<QuestionAnswers> } {
    const entry = this.entries.get(sessionId)
    if (!entry) throw new ManagerError("SESSION_NOT_FOUND", `session ${sessionId} not found`)
    const qid = `${sessionId}:q${entry.questionSeq++}`
    let resolveAnswers!: (answers: QuestionAnswers) => void
    const answerPromise = new Promise<QuestionAnswers>((resolve) => {
      resolveAnswers = resolve
    })
    entry.pendingQuestions.set(qid, { qid, callerItemId: item.callerItemId, sessionId, resolve: resolveAnswers })
    entry.index.append({ type: "question", id: qid, question: item.question, options: item.options })
    entry.lastActivityMs = this.currentNow()
    return { qid, answerPromise }
  }

  async cancel(id: string): Promise<void> {
    this.requireLive(id).agent.cancel({ kind: "user" })
  }

  async dispose(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) throw new ManagerError("SESSION_NOT_FOUND", `session ${id} not found`)
    await this.dropEntry(entry)
  }

  private async dropEntry(entry: SessionEntry): Promise<void> {
    this.settlePending(entry)
    if (entry.handle) await entry.handle.dispose().catch(() => {})
    this.entries.delete(entry.meta.id)
  }

  async answerApproval(id: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
    const pending = this.entries.get(id)?.pendingApprovals.get(approvalId)
    if (!pending) throw new ManagerError("APPROVAL_NOT_FOUND", `approval ${approvalId} not pending`)
    pending.resolve(decision === "allow" ? "allowed-once" : "rejected")
    this.entries.get(id)?.pendingApprovals.delete(approvalId)
  }

  async withdraw(): Promise<void> {
    for (const entry of [...this.entries.values()]) {
      await this.dropEntry(entry)
    }
  }

  private settleApprovals(entry: SessionEntry): void {
    for (const pending of entry.pendingApprovals.values()) {
      pending.resolve("cancelled")
    }
    entry.pendingApprovals.clear()
  }

  private settleQuestions(entry: SessionEntry): void {
    for (const pending of entry.pendingQuestions.values()) {
      pending.resolve({ answers: [] })
    }
    entry.pendingQuestions.clear()
  }

  private settlePending(entry: SessionEntry): void {
    this.settleApprovals(entry)
    this.settleQuestions(entry)
  }

  setPendingApprovalForTest(sessionId: string, approvalId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) throw new ManagerError("SESSION_NOT_FOUND", `session ${sessionId} not found`)
    entry.pendingApprovals.set(approvalId, { approval: { id: approvalId, toolName: "tool" }, resolve: () => {} })
  }

  private requireLive(id: string): AgentHandleLike {
    const entry = this.entries.get(id)
    if (!entry?.handle) throw new ManagerError("SESSION_NOT_FOUND", `session ${id} not live`)
    return entry.handle
  }
}

function isoDate(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString()
  return new Date(0).toISOString()
}
