export type BadgeTone = "green" | "blue" | "gray" | "orange"

export interface Badge {
  label: string
  tone: BadgeTone
}

export interface InlineSeg {
  text: string
  /** green/orange 用等宽强调色，strong 白色加粗 */
  accent?: "green" | "orange" | "strong"
}

export interface ProjectMember {
  initials: string
}

export interface ProjectSummary {
  id: string
  name: string
  /** 两字母缩写，用于方块标识 */
  shortName: string
  description: string
  progressPct: number
  weeklyDone: number
  weeklyTotal: number
  activeRequirements: number
  overdue: number
  members: ProjectMember[]
}

export interface PriorityCard {
  badge?: Badge
  title: string
  hint: string
  actionLabel?: string
}

export type MessageBlock =
  | { kind: "paragraph"; segs: InlineSeg[] }
  | { kind: "bullets"; items: InlineSeg[][] }
  | {
      kind: "steps"
      items: { state: "done" | "active" | "pending"; text: string }[]
    }
  | { kind: "cards"; cards: PriorityCard[] }
  | { kind: "actions"; actions: string[] }
  | { kind: "code"; filename: string; code: string }
  | { kind: "notice"; title: string; hint: string }

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  time: string
  /** user 消息：纯文本 */
  text?: string
  /** assistant 消息：富块 */
  blocks?: MessageBlock[]
  meta?: string
}

export interface Artifact {
  id: string
  kind: "task" | "doc" | "commit"
  title: string
  subtitle: string
  live?: boolean
}

export type Priority = "P0" | "P1" | "P2"

/** agent 回复：富块 + 产生的会话产出物 */
export interface AgentReply {
  blocks: MessageBlock[]
  artifacts?: Artifact[]
}

/**
 * agent 能力的唯一选择缝（Service Definition 角色）。
 * 阶段二多 provider 时演进为注册制 registerAgentProvider(provider): () => void，
 * 且行为不得依赖注册顺序。
 */
export interface AgentClient {
  reply(input: string): Promise<AgentReply>
}