import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { domainTable, defineDomain } from "@deepseek-ai/dsh-storage-domain"
import { z as zod } from "zod"

export const PROJECT_STATUSES = ["active", "paused", "done", "archived"] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const projectRecordSchema = zod.object({
  name: zod.string().min(1),
  description: zod.string(),
  status: zod.enum(PROJECT_STATUSES),
  workspacePath: zod.string().min(1),
  workspaceId: zod.string().min(1),
  createdAt: zod.string().min(1),
})
export type ProjectRecord = zod.infer<typeof projectRecordSchema>

export const projectsDomainSpec = defineDomain({
  name: "projects",
  version: 1,
  tables: { projects: domainTable(projectRecordSchema) },
})

const NAME_RE = /^[^\\/:*?"<>|\x00-\x1f]+$/

export function isValidProjectName(raw: string): boolean {
  const name = raw.trim()
  if (name.length < 1 || name.length > 64) return false
  if (name === "." || name === "..") return false
  return NAME_RE.test(name)
}

export const DEFAULT_CONFIG = { defaultWorkspaceRoot: "~/octopus-projects" }

export function resolveDefaultWorkspaceRoot(configured?: string): string {
  const raw = configured?.trim() ? configured.trim() : DEFAULT_CONFIG.defaultWorkspaceRoot
  if (raw === "~") return homedir()
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return join(homedir(), raw.slice(2))
  return resolve(isAbsolute(raw) ? raw : raw)
}
