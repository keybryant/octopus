export type TaskStatus = "todo" | "doing" | "review" | "done"

export type Priority = "P0" | "P1" | "P2"

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

export interface TaskDraft {
  title: string
  description?: string
  priority?: Priority
  assignee?: string
}

export type TaskPatch = Partial<
  Pick<TaskRecord, "title" | "description" | "priority" | "status" | "assignee">
>
