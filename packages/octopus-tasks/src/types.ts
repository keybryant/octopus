export type TaskStatus = "todo" | "doing" | "review" | "done"

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "review", "done"]

/** 任务状态变更事件（ctx 事件总线）：载荷为变更后的任务记录 */
export const TASK_STATUS_CHANGED_EVENT = "octopus-tasks/task-status-changed"

declare module "@deepseek-ai/cordis" {
  interface Events {
    "octopus-tasks/task-status-changed"(record: TaskRecord): void
  }
}

export interface TaskRecord {
  id: string
  title: string
  description: string
  requirementId: string
  projectId: string
  status: TaskStatus
  /** 执行该任务的智能体角色 id（如 octopus-developer / octopus-designer；缺省用平台默认预设） */
  agent?: string
  /** 任务子会话 id（octopus-workflow 内部写入；REST 客户端不可指定） */
  agentSessionId?: string
  /** 子 agent 完成时自报的简短总结（octopus-workflow 内部写入） */
  agentSummary?: string
  createdAt: string
  updatedAt: string
}

/** AI 拆解草稿（decompose 返回 / batch 入参的任务内容，不含主键）*/
export interface TaskDraft {
  title: string
  description?: string
  agent?: string
}

/** 单条创建入参（requirementId/projectId 必填）*/
export interface TaskInput extends TaskDraft {
  requirementId: string
  projectId: string
}

export type TaskPatch = Partial<
  Pick<TaskRecord, "title" | "description" | "status">
>

export type TasksErrorCode = "not-found" | "invalid-input" | "invalid-transition"

export class TasksError extends Error {
  constructor(
    readonly code: TasksErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "TasksError"
  }
}

/** 合法状态迁移表：单向推进，done 为终态，不可回退 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["doing"],
  doing: ["review"],
  review: ["done"],
  done: [],
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new TasksError(
      "invalid-transition",
      `invalid status transition: ${from} -> ${to}`,
    )
  }
}
