import { z } from "zod"
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain"

/** requirements 表记录 schema：与 RequirementRecord 保持一致的持久化边界 */
const requirementSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  priority: z.enum(["P0", "P1", "P2"]),
  status: z.enum(["backlog", "planned", "in-progress", "review", "done"]),
  // 老数据无 projectId：缺省为空串（查询时被过滤到任意项目之外）
  projectId: z.string().min(1).default(""),
  source: z.enum(["manual", "chat"]),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** meta 表：内部序号（id 生成），在写链上原子自增 */
const metaSchema = z.object({
  seq: z.number().int().nonnegative(),
})

export const REQUIREMENTS_DOMAIN = defineDomain({
  name: "octopus_requirements",
  version: 1,
  tables: {
    requirements: domainTable(requirementSchema),
    meta: domainTable(metaSchema),
  },
})

export type RequirementsDomain = typeof REQUIREMENTS_DOMAIN
