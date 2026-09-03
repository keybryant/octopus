export type TaskStatus = "todo" | "doing" | "review" | "done"

export interface TaskRecord {
  id: string
  title: string
  description: string
  requirementId: string
  projectId: string
  status: TaskStatus
  agent?: string
  agentSessionId?: string
  agentSummary?: string
  createdAt: string
  updatedAt: string
}

export interface TaskDraft {
  title: string
  description?: string
  agent?: string
}

export type TaskPatch = Partial<
  Pick<TaskRecord, "title" | "description" | "status">
>
