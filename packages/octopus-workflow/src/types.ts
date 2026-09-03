import type { ProjectView } from "octopus-projects"
import type { RequirementRecord } from "octopus-requirements"
import type { TaskRecord } from "octopus-tasks"

/**
 * 任务子会话事件（环形缓冲条目；镜像 octopus-agent AgentStreamEvent 的最小版）
 */
export type TaskSessionEvent =
  | { type: "status"; status: "idle" | "running" }
  | { type: "user-message"; text: string }
  | { type: "assistant-text"; text: string }
  | { type: "tool-call"; name: string; summary: string }
  | { type: "tool-result"; name: string; ok: boolean; preview: string }
  | { type: "turn"; at: "start" | "end"; reason?: string }
  | { type: "error"; message: string }
  | { type: "monitor-halt"; reason: string; message: string }

/**
 * 镜像 octopus-tasks 的 TaskPatch（该包根导出缺失，此处从 TaskRecord 本地推导，
 * 与 octopus-tasks 的 `Partial<Pick<TaskRecord, "title" | "description" | "status">>` 结构性等价）
 */
export type TaskPatch = Partial<Pick<TaskRecord, "title" | "description" | "status">>

export interface RequirementStoreLike {
  get(id: string): RequirementRecord | undefined
}

export interface TaskStoreLike {
  get(id: string): TaskRecord | undefined
  update(id: string, patch: TaskPatch): Promise<TaskRecord>
  attachSession(id: string, sessionId: string | null): Promise<TaskRecord>
  setAgentSummary(id: string, summary: string): Promise<TaskRecord>
  reopen(id: string): Promise<TaskRecord>
}

export interface ProjectStoreLike {
  get(id: string): ProjectView | undefined
}

export interface TaskSessionLike {
  start(taskId: string): Promise<{ sessionId: string; task: TaskRecord }>
  stop(taskId: string): Promise<TaskRecord>
  send(taskId: string, message: string): Promise<void>
  status(taskId: string): Promise<TaskSessionStatus>
  transcript(taskId: string, opts?: { after?: number; limit?: number }): Promise<{ events: TaskSessionEvent[]; total: number }>
  ask(taskId: string, message: string, timeoutMs: number): Promise<{ reply: string; events: TaskSessionEvent[] }>
}

export interface TaskSessionStatus {
  task: TaskRecord
  session: { sessionId: string | null; live: boolean; status?: "idle" | "running" }
  events: TaskSessionEvent[]
}

/** 子会话作用域上下文最小面（buildTaskSetup 注入工具/restrict 的挂载点；与真实 agentCtx 结构兼容） */
export interface AgentCtxLike {
  tools: {
    register(definition: unknown): unknown
    restrict(filter: { allow?: string[]; deny?: string[] }): unknown
  }
}

export type WorkflowErrorCode =
  | "task-not-found"
  | "project-not-found"
  | "project-scope"
  | "session-unavailable"
  | "not-found"
  | "timeout"
  | "invalid-input"

export class WorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "WorkflowError"
  }
}
