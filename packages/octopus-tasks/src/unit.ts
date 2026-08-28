import { z } from "zod"
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain"

const taskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  requirementId: z.string(),
  projectId: z.string().min(1),
  status: z.enum(["todo", "doing", "review", "done"]),
  agentSessionId: z.string().optional(),
  agentSummary: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const metaSchema = z.object({
  seq: z.number().int().nonnegative(),
})

export const TASKS_DOMAIN = defineDomain({
  name: "octopus_tasks",
  version: 1,
  tables: {
    tasks: domainTable(taskSchema),
    meta: domainTable(metaSchema),
  },
})

export type TasksDomain = typeof TASKS_DOMAIN
