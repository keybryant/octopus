import { useCallback, useEffect, useRef, useState } from "react"
import { timeGreeting } from "../greeting"
import { currentProject } from "./datasource"
import type {
  AgentClient,
  AgentStreamEvent,
  ApprovalBlock,
  Artifact,
  ChatMessage,
  MessageBlock,
  SessionMeta,
} from "./types"

export type ChatStatus = "idle" | "thinking"
export type PendingQuestion = { id: string; question: string; options?: string[] } | null

export interface ChatState {
  messages: ChatMessage[]
  status: ChatStatus
  artifacts: Artifact[]
  pendingQuestion: PendingQuestion
  approvals: ApprovalBlock[]
  /** 当前 turn 是否打开（turn start..end 之间） */
  turnOpen: boolean
  /** turn 开始时间戳，用于 meta 秒数 */
  turnStartedAt: number | null
  /** 当前 turn 正在累积的助手消息 id（streaming 时未落定） */
  anchorId: string | null
  /** 尚无助手消息可挂载的块（附着到下一个助手消息） */
  deferred: MessageBlock[]
}

// ── 项目 ↔ PM 会话绑定 ──────────────────────────────────────────────

const PROJECT_SESSIONS_KEY = "octopus.projectSessions"

export interface ProjectSessionStore {
  get(projectId: string): string | null
  set(projectId: string, sessionId: string): void
}

/** localStorage 持久化的 projectId → PM 会话 id 映射（隐私模式等场景降级为内存） */
export function createProjectSessionStore(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): ProjectSessionStore {
  let cache: Record<string, string> | null = null
  const read = (): Record<string, string> => {
    if (cache) return cache
    try {
      const raw = storage?.getItem(PROJECT_SESSIONS_KEY)
      cache = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    } catch {
      cache = {}
    }
    return cache
  }
  return {
    get(projectId) {
      return read()[projectId] ?? null
    },
    set(projectId, sessionId) {
      const next = { ...read(), [projectId]: sessionId }
      cache = next
      try {
        storage?.setItem(PROJECT_SESSIONS_KEY, JSON.stringify(next))
      } catch {
        /* 忽略 */
      }
    },
  }
}

/** 任务执行会话（octopus-workflow 创建，id 前缀 task-） */
export function isTaskSession(meta: Pick<SessionMeta, "id">): boolean {
  return meta.id.startsWith("task-")
}

/** 当前项目会话（PM 会话 + 任务执行会话），按创建时间倒序 */
export function projectSessions(sessions: SessionMeta[], workspacePath: string): SessionMeta[] {
  return sessions
    .filter((s) => s.cwd === workspacePath)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * 解析项目的 PM 会话：映射命中（会话仍存在）优先，否则回落 cwd 匹配的
 * 最新非任务会话；无匹配返回 null（调用方自动创建）。
 */
export function resolvePmSession(
  sessions: SessionMeta[],
  workspacePath: string,
  bound: string | null,
): SessionMeta | null {
  if (bound) {
    const hit = sessions.find((s) => s.id === bound)
    if (hit) return hit
  }
  return (
    sessions
      .filter((s) => s.cwd === workspacePath && !isTaskSession(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

export function defaultSessionStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

function nowHHmm(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function buildWelcome(contextLabel?: string): ChatMessage {
  const label = contextLabel ?? currentProject().name
  return {
    id: nextId("msg"),
    role: "assistant",
    time: nowHHmm(),
    text: `${timeGreeting(new Date().getHours())}。当前上下文：${label}。今天有 2 个任务临近到期，要我先把今天的优先事项列出来，还是直接开始处理某个需求？`,
  }
}

export function initialState(contextLabel?: string): ChatState {
  return {
    messages: [buildWelcome(contextLabel)],
    status: "idle",
    artifacts: [],
    pendingQuestion: null,
    approvals: [],
    turnOpen: false,
    turnStartedAt: null,
    anchorId: null,
    deferred: [],
  }
}

function notice(title: string, hint: string, tone?: "info" | "danger"): MessageBlock {
  return { kind: "notice", title, hint, tone }
}

function addArtifact(artifacts: Artifact[], name: string, callId: string, summary: string): Artifact[] {
  if (artifacts.some((a) => a.id === callId)) return artifacts
  if (name === "todo_write") {
    return [
      ...artifacts,
      { id: callId, kind: "task", title: summary.slice(0, 24), subtitle: "Agent 任务清单", live: true },
    ]
  }
  if (name === "str_replace_editor" || name === "write_file" || name === "edit_file") {
    return [...artifacts, { id: callId, kind: "doc", title: summary.slice(0, 24), subtitle: "Agent 产出", live: false }]
  }
  return artifacts
}

function splitLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim().length > 0)
}

function appendSegs(blocks: MessageBlock[] | undefined, lines: string[]): MessageBlock[] {
  const next = blocks ? [...blocks] : []
  const last = next.at(-1)
  if (last && last.kind === "paragraph") {
    next[next.length - 1] = { kind: "paragraph", segs: [...last.segs, ...lines.map((text) => ({ text }))] }
    return next
  }
  return [...next, { kind: "paragraph", segs: lines.map((text) => ({ text })) }]
}

function anchorNotice(state: ChatState, block: MessageBlock): ChatState {
  const id = state.anchorId
  if (id === null) return { ...state, deferred: [...state.deferred, block] }
  return {
    ...state,
    messages: state.messages.map((m) =>
      m.id === id && m.role === "assistant" ? { ...m, blocks: [...(m.blocks ?? []), block] } : m,
    ),
  }
}

/** 共享归约器：live 订阅与 history 回放走同一套逻辑 */
export function reduceEvent(state: ChatState, ev: AgentStreamEvent): ChatState {
  switch (ev.type) {
    case "user-message":
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: nextId("msg"), role: "user", time: nowHHmm(), text: ev.text },
        ],
      }
    case "assistant-text": {
      const lines = splitLines(ev.text)
      const id = state.anchorId
      if (id === null) {
        const blocks: MessageBlock[] = [...state.deferred, ...appendSegs(undefined, lines)]
        const msg: ChatMessage = { id: nextId("msg"), role: "assistant", time: nowHHmm(), blocks }
        return { ...state, messages: [...state.messages, msg], anchorId: msg.id, deferred: [] }
      }
      if (lines.length === 0) return state
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === id ? { ...m, blocks: appendSegs(m.blocks, lines) } : m)),
      }
    }
    case "turn": {
      if (ev.at === "start") {
        return {
          ...state,
          status: "thinking",
          turnOpen: true,
          turnStartedAt: Date.now(),
          anchorId: null,
          deferred: [],
        }
      }
      const secs = state.turnStartedAt === null ? 0 : Math.max(0, Math.floor((Date.now() - state.turnStartedAt) / 1000))
      const meta = `${nowHHmm()} · gpt-4 · ${secs}s`
      let messages = state.messages
      if (state.anchorId === null && state.deferred.length > 0) {
        const msg: ChatMessage = {
          id: nextId("msg"),
          role: "assistant",
          time: nowHHmm(),
          blocks: [...state.deferred],
          meta,
        }
        messages = [...messages, msg]
      } else if (state.anchorId !== null) {
        messages = messages.map((m) => (m.id === state.anchorId ? { ...m, meta: m.meta ?? meta } : m))
      }
      return { ...state, messages, status: "idle", turnOpen: false, turnStartedAt: null, anchorId: null, deferred: [] }
    }
    case "status":
      return { ...state, status: state.turnOpen || ev.status === "running" ? "thinking" : "idle" }
    case "tool-call":
      return {
        ...anchorNotice(state, notice(ev.name, ev.summary)),
        artifacts: addArtifact(state.artifacts, ev.name, ev.callId, ev.summary),
      }
    case "tool-result":
      if (ev.ok) return state
      return anchorNotice(state, notice(ev.name, ev.preview, "danger"))
    case "approval": {
      const block: ApprovalBlock = { kind: "approval", approvalId: ev.id, toolName: ev.toolName, reason: ev.reason }
      return {
        ...state,
        approvals: [...state.approvals, block],
        messages: [
          ...state.messages,
          { id: nextId("msg"), role: "assistant", time: nowHHmm(), blocks: [{ ...block }] },
        ],
      }
    }
    case "question":
      return { ...state, pendingQuestion: { id: ev.id, question: ev.question, options: ev.options } }
    case "error": {
      const block = notice("错误", ev.message)
      if (state.anchorId !== null) return anchorNotice(state, block)
      return {
        ...state,
        messages: [...state.messages, { id: nextId("msg"), role: "assistant", time: nowHHmm(), blocks: [block] }],
      }
    }
  }
}

export function useChat(
  client: AgentClient | null,
  opts?: {
    contextLabel?: string
    projectId?: string
    workspacePath?: string
    storage?: Pick<Storage, "getItem" | "setItem"> | null
    /** 绑定/切换会话后回传该会话的 agent 预设（无预设时回传 null），供上层同步预设选择器 */
    onPresetChange?: (preset: string | null) => void
  },
): {
  messages: ChatMessage[]
  status: ChatStatus
  send: (text: string) => void
  artifacts: Artifact[]
  pendingQuestion: PendingQuestion
  answerQuestion: (text: string) => void
  approvals: ApprovalBlock[]
  decideApproval: (id: string, decision: "allow" | "deny") => void
  thinking: boolean
  switchSession: (id: string) => Promise<void>
  switchProject: (projectId: string, workspacePath: string, sessionOpts?: { agentPreset?: string }) => Promise<void>
  newSession: (opts?: { cwd?: string; agentPreset?: string }) => Promise<string>
} {
  const [state, setState] = useState<ChatState>(() => initialState(opts?.contextLabel))
  const stateRef = useRef(state)
  stateRef.current = state
  const clientRef = useRef(client)
  clientRef.current = client
  const labelRef = useRef(opts?.contextLabel)
  labelRef.current = opts?.contextLabel
  const projectRef = useRef({ projectId: opts?.projectId, workspacePath: opts?.workspacePath })
  projectRef.current = { projectId: opts?.projectId, workspacePath: opts?.workspacePath }
  const [store] = useState(() =>
    createProjectSessionStore(opts?.storage !== undefined ? opts.storage : defaultSessionStorage()),
  )
  const projectSeqRef = useRef(0)
  const bootstrapped = useRef(false)
  const presetChangeRef = useRef(opts?.onPresetChange)
  presetChangeRef.current = opts?.onPresetChange

  /** 解析/创建项目 PM 会话并载入（绑定核心） */
  const bindProject = useCallback(async (projectId: string, workspacePath: string, sessionOpts?: { agentPreset?: string }) => {
    const c = clientRef.current
    if (!c) return
    const seq = ++projectSeqRef.current
    try {
      const sessions = await c.listSessions()
      const target = resolvePmSession(sessions, workspacePath, store.get(projectId))
      if (target) {
        store.set(projectId, target.id)
        if (seq !== projectSeqRef.current) return
        await c.switchTo(target.id)
        const events = await c.history(target.id)
        if (seq !== projectSeqRef.current) return
        setState(events.reduce(reduceEvent, initialState(labelRef.current)))
        presetChangeRef.current?.(target.agentPreset ?? null)
        return
      }
      if (seq !== projectSeqRef.current) return
      const id = await c.startSession({ cwd: workspacePath, ...sessionOpts })
      if (seq !== projectSeqRef.current) return
      store.set(projectId, id)
      setState(initialState(labelRef.current))
      presetChangeRef.current?.(sessionOpts?.agentPreset ?? null)
    } catch {
      /* 保持当前状态 */
    }
  }, [])

  useEffect(() => {
    if (!client) return
    const unsub = client.subscribe((ev) => {
      setState((prev) => reduceEvent(prev, ev))
    })
    if (!bootstrapped.current) {
      bootstrapped.current = true
      void (async () => {
        try {
          const { projectId, workspacePath } = projectRef.current
          if (projectId && workspacePath) {
            await bindProject(projectId, workspacePath)
            return
          }
          const sessions = await client.listSessions()
          if (sessions.length === 0) {
            await client.startSession()
            return
          }
          const target = [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
          await client.switchTo(target.id)
          const events = await client.history(target.id)
          setState(events.reduce(reduceEvent, initialState(labelRef.current)))
        } catch {
          /* 保持 welcome */
        }
      })()
    }
    return unsub
  }, [client, bindProject])

  const send = useCallback((text: string) => {
    const trimmed = text.trim()
    const c = clientRef.current
    if (!trimmed || !c) return
    const { status, pendingQuestion } = stateRef.current
    if (status === "thinking") return
    if (pendingQuestion) {
      void c.send(trimmed, pendingQuestion.id).catch(() => undefined)
      setState((prev) => ({ ...prev, pendingQuestion: null }))
      return
    }
    void c.send(trimmed).catch(() => undefined)
  }, [])

  const answerQuestion = useCallback((text: string) => {
    const trimmed = text.trim()
    const c = clientRef.current
    if (!trimmed || !c) return
    const q = stateRef.current.pendingQuestion
    if (!q) return
    void c.send(trimmed, q.id).catch(() => undefined)
    setState((prev) => ({ ...prev, pendingQuestion: null }))
  }, [])

  const decideApproval = useCallback((id: string, decision: "allow" | "deny") => {
    void clientRef.current?.answerApproval(id, decision).catch(() => undefined)
    setState((prev) => ({ ...prev, approvals: prev.approvals.filter((a) => a.approvalId !== id) }))
  }, [])

  const switchSession = useCallback(async (id: string) => {
    const c = clientRef.current
    if (!c) return
    await c.switchTo(id)
    const events = await c.history(id)
    const next = events.reduce(reduceEvent, initialState(labelRef.current))
    setState(next)
    try {
      const list = await c.listSessions()
      const meta = list.find((s) => s.id === id)
      const { projectId, workspacePath } = projectRef.current
      // 手动切换：若目标是当前项目的 PM 会话（非任务会话），更新映射为新的活动会话
      if (projectId && workspacePath && meta && meta.cwd === workspacePath && !isTaskSession(meta)) {
        store.set(projectId, id)
      }
      // 同步预设选择器到目标会话的 agent 预设
      presetChangeRef.current?.(meta?.agentPreset ?? null)
    } catch {
      /* 忽略 */
    }
  }, [])

  /** 切换项目：解析/创建该项目 PM 会话并载入（映射命中 → cwd 匹配 → 自动创建） */
  const switchProject = useCallback(async (projectId: string, workspacePath: string, sessionOpts?: { agentPreset?: string }) => {
    await bindProject(projectId, workspacePath, sessionOpts)
  }, [bindProject])

  const newSession = useCallback(async (sessionOpts?: { cwd?: string; agentPreset?: string }) => {
    const c = clientRef.current
    if (!c) throw new Error("useChat: client is not ready")
    const id = await c.startSession(sessionOpts)
    setState(initialState(labelRef.current))
    const { projectId, workspacePath } = projectRef.current
    if (projectId && workspacePath && sessionOpts?.cwd === workspacePath) {
      store.set(projectId, id)
    }
    return id
  }, [])

  return {
    messages: state.messages,
    status: state.status,
    send,
    artifacts: state.artifacts,
    pendingQuestion: state.pendingQuestion,
    answerQuestion,
    approvals: state.approvals,
    decideApproval,
    thinking: state.status === "thinking",
    switchSession,
    switchProject,
    newSession,
  }
}
