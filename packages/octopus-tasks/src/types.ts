export type TaskStatus = "todo" | "doing" | "review" | "done"

export type Priority = "P0" | "P1" | "P2"

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "review", "done"]

export const PRIORITIES: readonly Priority[] = ["P0", "P1", "P2"]

export interface TaskRecord {
  id: string
  title: string
  description: string
  requirementId: string
  projectId: string
  priority: Priority
  status: TaskStatus
  assignee: string | null
  createdAt: string
  updatedAt: string
}

/** AI 拆解草稿（decompose 返回 / batch 入参的任务内容，不含主键）*/
export interface TaskDraft {
  title: string
  description?: string
  priority?: Priority
  assignee?: string
}

/** 单条创建入参（requirementId/projectId 必填）*/
export interface TaskInput extends TaskDraft {
  requirementId: string
  projectId: string
}

export type TaskPatch = Partial<
  Pick<TaskRecord, "title" | "description" | "priority" | "status" | "assignee">
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
