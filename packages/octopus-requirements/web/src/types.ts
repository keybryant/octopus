export type RequirementStatus = "backlog" | "planned" | "in-progress" | "review" | "done"

export type Priority = "P0" | "P1" | "P2"

export interface RequirementRecord {
  id: string
  title: string
  description: string
  priority: Priority
  status: RequirementStatus
  owner: string | null
  source: "manual" | "chat"
  createdAt: string
  updatedAt: string
}

export type RequirementPatch = Partial<
  Pick<RequirementRecord, "title" | "description" | "priority" | "status" | "owner">
>
