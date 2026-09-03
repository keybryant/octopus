import type {
  AgentClient,
  AgentReply,
  AgentStreamEvent,
  Artifact,
  MessageBlock,
  PresetInfo,
  PresetModelSpec,
  SessionContextInfo,
  SessionMeta,
} from "./types"

const PRIORITY_SCRIPT: MessageBlock[] = [
  {
    kind: "paragraph",
    segs: [{ text: "结合截止时间和阻塞关系，今天建议按这个顺序处理：" }],
  },
  {
    kind: "cards",
    cards: [
      {
        badge: { label: "逾期", tone: "orange" },
        title: "TASK-2850 · React 19 升级兼容性验证",
        hint: "已逾期 2 天 · 阻塞 REQ-118 联调 · 建议今天集中解决",
        actionLabel: "让 Agent 接手 →",
      },
      {
        badge: { label: "今天 18:00", tone: "blue" },
        title: "TASK-2841 · 认证模块 OAuth 2.0 重构",
        hint: "进度 65% · 剩余工作约 3 小时 · 张三负责",
        actionLabel: "查看详情",
      },
      {
        badge: { label: "本周内", tone: "gray" },
        title: "REQ-121 · Agent 任务编排可视化评审",
        hint: "周四评审会前需要补充流程图初稿",
      },
    ],
  },
]

const DELEGATION_SCRIPT: { blocks: MessageBlock[]; artifacts: Artifact[] } = {
  blocks: [
    {
      kind: "paragraph",
      segs: [
        { text: "收到。我建了一条自动化流水线来接管 " },
        { text: "TASK-2850", accent: "green" },
        { text: "：" },
      ],
    },
    {
      kind: "steps",
      items: [
        { state: "done", text: "升级依赖并修复 Breaking Changes（已定位 4 处）" },
        { state: "active", text: "运行全量回归测试（预计 25 分钟）…" },
        { state: "pending", text: "输出报告并发给你 & 王倩" },
      ],
    },
    { kind: "actions", actions: ["暂停执行", "查看执行日志"] },
  ],
  artifacts: [
    {
      id: "art-pipeline-2857",
      kind: "task",
      title: "TASK-2857 自动化流水线",
      subtitle: "升级依赖 + 回归测试 + 报告通知",
      live: true,
    },
  ],
}

const ACK_SCRIPT: MessageBlock[] = [
  {
    kind: "paragraph",
    segs: [
      { text: "收到。当前上下文是 " },
      { text: "Octopus Platform", accent: "green" },
      { text: "，可以让我列出待办、拆解需求或生成周报。" },
    ],
  },
]

function pickScript(input: string): AgentReply {
  if (/待办|优先|事项/.test(input)) return { blocks: PRIORITY_SCRIPT }
  if (/接手|自动|跑/.test(input)) return { blocks: DELEGATION_SCRIPT.blocks, artifacts: DELEGATION_SCRIPT.artifacts }
  return { blocks: ACK_SCRIPT }
}

type WithoutIdx<T> = T extends AgentStreamEvent ? Omit<T, "idx"> : never
type ScriptedEvent = WithoutIdx<AgentStreamEvent>

const PRIORITY_EVENTS: ScriptedEvent[] = [
  { type: "assistant-text", text: "结合截止时间和阻塞关系，今天建议按这个顺序处理：" },
  { type: "tool-call", callId: "mock-t1", name: "todo_write", summary: "TASK-2850 · React 19 升级兼容性验证" },
  { type: "tool-call", callId: "mock-t2", name: "todo_write", summary: "TASK-2841 · 认证模块 OAuth 2.0 重构" },
  { type: "tool-call", callId: "mock-t3", name: "todo_write", summary: "REQ-121 · Agent 任务编排可视化评审" },
]

const DELEGATION_EVENTS: ScriptedEvent[] = [
  {
    type: "assistant-text",
    text: "收到。我建了一条自动化流水线来接管 TASK-2850：升级依赖并修复 Breaking Changes（已定位 4 处）→ 运行全量回归测试（预计 25 分钟）→ 输出报告并发给你 & 王倩。",
  },
  { type: "tool-call", callId: "mock-t4", name: "str_replace_editor", summary: "TASK-2850 升级依赖 + 回归测试 + 报告通知" },
]

const ACK_EVENTS: ScriptedEvent[] = [
  {
    type: "assistant-text",
    text: "收到。当前上下文是 Octopus Platform，可以让我列出待办、拆解需求或生成周报。",
  },
]

function pickEvents(input: string): ScriptedEvent[] {
  if (/待办|优先|事项/.test(input)) return PRIORITY_EVENTS
  if (/接手|自动|跑/.test(input)) return DELEGATION_EVENTS
  return ACK_EVENTS
}

export function createMockAgentClient(delayMs = 600): AgentClient {
  let idx = 0
  const handlers = new Set<(ev: AgentStreamEvent) => void>()

  function emit(ev: ScriptedEvent): void {
    const next: AgentStreamEvent = { ...ev, idx: ++idx }
    for (const handler of [...handlers]) handler(next)
  }

  async function send(text: string, _answerQuestionId?: string): Promise<void> {
    const timeline: ScriptedEvent[] = [
      { type: "user-message", text },
      { type: "turn", at: "start" },
      ...pickEvents(text),
      { type: "turn", at: "end" },
      { type: "status", status: "idle" },
    ]
    for (const ev of timeline) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      emit(ev)
    }
  }

  return {
    reply(input: string): Promise<AgentReply> {
      return new Promise((resolve) => {
        setTimeout(() => resolve(pickScript(input)), delayMs)
      })
    },
    async startSession(): Promise<string> {
      return "mock"
    },
    async switchTo(): Promise<void> {},
    async listSessions(): Promise<SessionMeta[]> {
      return [{ id: "mock", createdAt: new Date().toISOString(), cwd: null, title: "Mock 会话", live: true }]
    },
    async history(): Promise<AgentStreamEvent[]> {
      return []
    },
    subscribe(handler: (ev: AgentStreamEvent) => void): () => void {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    send,
    async cancel(): Promise<void> {},
    async disposeSession(): Promise<void> {},
    async answerApproval(): Promise<void> {},
    async listPresets(): Promise<PresetInfo[]> {
      return [
        { id: "standard", name: "标准模式" },
        { id: "minimal", name: "最小模式" },
      ]
    },
    async savePresetModel(): Promise<void> {},
    async getSessionContext(): Promise<SessionContextInfo> {
      return { live: true, provider: "mock", model: "mock-flash", prompt: "mock system prompt", context: "mock runtime context" }
    },
  }
}

export function createHttpAgentClient(baseUrl = "/api/octopus-agent"): AgentClient {
  let sessionId: string | null = null
  let lastIdx = -1
  const handlers = new Set<(ev: AgentStreamEvent) => void>()
  let es: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function deliver(ev: AgentStreamEvent): void {
    if (ev.idx <= lastIdx) return
    lastIdx = ev.idx
    for (const handler of [...handlers]) handler(ev)
  }

  function closeStream(): void {
    if (es) {
      es.close()
      es = null
    }
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function poll(): Promise<void> {
    if (!sessionId) return
    try {
      const res = await fetch(`${baseUrl}/sessions/${sessionId}/events?after=${lastIdx + 1}`)
      const body = await res.text()
      for (const frame of body.split("\n\n")) {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "))
        if (!dataLine) continue
        try {
          deliver(JSON.parse(dataLine.slice(6)) as AgentStreamEvent)
        } catch {
          continue
        }
      }
    } catch {
      return
    }
  }

  function openStream(): void {
    if (!sessionId) return
    closeStream()
    const url = `${baseUrl}/sessions/${sessionId}/events?after=${lastIdx + 1}`
    if (typeof EventSource !== "undefined") {
      const source = new EventSource(url)
      source.onmessage = (msg) => {
        try {
          deliver(JSON.parse(msg.data) as AgentStreamEvent)
        } catch {
          return
        }
      }
      es = source
    } else {
      void poll()
      pollTimer = setInterval(() => void poll(), 250)
    }
  }

  async function post(path: string, payload?: Record<string, unknown>): Promise<void> {
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
    }
    if (payload !== undefined) init.body = JSON.stringify(payload)
    await fetch(`${baseUrl}${path}`, init)
  }

  function subscribe(handler: (ev: AgentStreamEvent) => void): () => void {
    handlers.add(handler)
    openStream()
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) closeStream()
    }
  }

  async function send(text: string, answerQuestionId?: string): Promise<void> {
    if (!sessionId) throw new Error("send: no active session")
    await post(
      `/sessions/${sessionId}/messages`,
      answerQuestionId !== undefined ? { text, answerQuestionId } : { text },
    )
  }

  return {
    reply(input: string): Promise<AgentReply> {
      return new Promise((resolve, reject) => {
        const blocks: MessageBlock[] = []
        let finished = false
        let unsub = (): void => undefined
        unsub = subscribe((ev) => {
          if (ev.type === "assistant-text") {
            blocks.push({ kind: "paragraph", segs: [{ text: ev.text }] })
          } else if (ev.type === "turn" && ev.at === "end") {
            finished = true
            unsub()
            resolve({ blocks })
          } else if (ev.type === "error") {
            finished = true
            unsub()
            resolve({ blocks })
          }
        })
        void send(input).catch((error) => {
          if (!finished) {
            finished = true
            unsub()
            reject(error)
          }
        })
      })
    },
    async startSession(opts?: { cwd?: string; agentPreset?: string }): Promise<string> {
      const res = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: opts?.cwd, agentPreset: opts?.agentPreset }),
      })
      const body = (await res.json()) as { session?: SessionMeta }
      if (!body.session) throw new Error("startSession: no session in response")
      sessionId = body.session.id
      lastIdx = -1
      openStream()
      return body.session.id
    },
    async switchTo(nextSessionId: string): Promise<void> {
      sessionId = nextSessionId
      lastIdx = -1
      openStream()
    },
    async listSessions(): Promise<SessionMeta[]> {
      const res = await fetch(`${baseUrl}/sessions`)
      const body = (await res.json()) as { items?: SessionMeta[] }
      return body.items ?? []
    },
    async history(targetSessionId: string): Promise<AgentStreamEvent[]> {
      const res = await fetch(`${baseUrl}/sessions/${targetSessionId}/history`)
      const body = (await res.json()) as { events?: AgentStreamEvent[] }
      const events = body.events ?? []
      if (events.length > 0) lastIdx = events[events.length - 1].idx
      return events
    },
    subscribe,
    send,
    async cancel(): Promise<void> {
      if (!sessionId) return
      await post(`/sessions/${sessionId}/cancel`)
    },
    async disposeSession(): Promise<void> {
      closeStream()
      if (sessionId) await fetch(`${baseUrl}/sessions/${sessionId}`, { method: "DELETE" })
      sessionId = null
    },
    async answerApproval(id: string, decision: "allow" | "deny"): Promise<void> {
      if (!sessionId) throw new Error("answerApproval: no active session")
      await post(`/sessions/${sessionId}/approvals/${id}`, { decision })
    },
    async listPresets(): Promise<PresetInfo[]> {
      const res = await fetch(`${baseUrl}/presets`)
      const body = (await res.json()) as { items?: PresetInfo[] }
      return body.items ?? []
    },
    async savePresetModel(presetId: string, spec: PresetModelSpec): Promise<void> {
      const res = await fetch(`${baseUrl}/presets/${presetId}/model`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: spec.provider, model: spec.model }),
      })
      if (!res.ok) throw new Error("savePresetModel: request failed")
    },
    async getSessionContext(targetSessionId: string): Promise<SessionContextInfo> {
      const res = await fetch(`${baseUrl}/sessions/${targetSessionId}/context`)
      if (!res.ok) throw new Error("getSessionContext: request failed")
      const body = (await res.json()) as SessionContextInfo
      if (!body || typeof body.live !== "boolean") throw new Error("getSessionContext: malformed response")
      return body
    },
  }
}

export async function createDefaultAgentClient(fetchImpl: typeof fetch = fetch): Promise<AgentClient> {
  try {
    const res = await fetchImpl("/api/octopus-agent/up", { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return createMockAgentClient()
    const body: unknown = await res.json()
    if (typeof body !== "object" || body === null || (body as { ok?: unknown }).ok !== true) {
      return createMockAgentClient()
    }
    return createHttpAgentClient()
  } catch {
    return createMockAgentClient()
  }
}
