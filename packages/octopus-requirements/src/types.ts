export type RequirementStatus = "backlog" | "planned" | "in-progress" | "review" | "done"

export type Priority = "P0" | "P1" | "P2"

export type RequirementSource = "manual" | "chat"

export const REQUIREMENT_STATUSES: readonly RequirementStatus[] = [
  "backlog",
  "planned",
  "in-progress",
  "review",
  "done",
]

export const PRIORITIES: readonly Priority[] = ["P0", "P1", "P2"]

export interface RequirementRecord {
  id: string
  title: string
  description: string
  priority: Priority
  status: RequirementStatus
  owner: string | null
  source: RequirementSource
  createdAt: string
  updatedAt: string
}

/** 新建需求入参（title 必填，其余可选） */
export interface RequirementInput {
  title: string
  description?: string
  priority?: Priority
  source?: RequirementSource
}

/** 更新入参：部分字段；status 变更需满足状态机 */
export type RequirementPatch = Partial<
  Pick<RequirementRecord, "title" | "description" | "priority" | "status" | "owner">
>

export type RequirementsErrorCode = "not-found" | "invalid-input" | "invalid-transition"

export class RequirementsError extends Error {
  constructor(
    readonly code: RequirementsErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "RequirementsError"
  }
}

/** 合法状态迁移表：按设计为单向推进，done 为终态，不可回退 */
export const REQUIREMENT_TRANSITIONS: Record<RequirementStatus, readonly RequirementStatus[]> = {
  backlog: ["planned"],
  planned: ["in-progress"],
  "in-progress": ["review"],
  review: ["done"],
  done: [],
}

export function canTransition(from: RequirementStatus, to: RequirementStatus): boolean {
  return REQUIREMENT_TRANSITIONS[from].includes(to)
}

export function assertTransition(from: RequirementStatus, to: RequirementStatus): void {
  if (!canTransition(from, to)) {
    throw new RequirementsError(
      "invalid-transition",
      `invalid status transition: ${from} -> ${to}`,
    )
  }
}
