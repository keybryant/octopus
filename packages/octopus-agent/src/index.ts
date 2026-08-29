import { randomInt } from "node:crypto"
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { renderContextSnapshot, renderPrompt } from "@deepseek-ai/dsh-system-prompt"
import { createAgentApi, BASE_PATH, type ApiRequest, type ApiResponse } from "./api.js"
import { AgentManager, type AgentsLike, type PersistenceLike } from "./manager.js"
import { ensureUserPresets, USER_PRESETS } from "./presets.js"

import type { PresetInfo } from "./types.js"

export const name = "octopus-agent"
export const inject = ["webServer", "agents"]

export const Config = z.object({
  defaultCwd: z.string().required(false),
  defaultAgentPreset: z.string().default("standard"),
  provider: z.string().required(false),
  model: z.string().required(false),
  idleTtlMs: z.number().default(30 * 60 * 1000),
})

type AgentConfig = ReturnType<typeof Config>

interface WebServerLike {
  register(route: {
    kind: "exact" | "prefix"
    path: string
    handler: (req: ApiRequest, res: ApiResponse) => Promise<void>
  }): () => void
}

interface DefaultModelLike {
  currentSelection?(): { provider?: string; model?: string } | undefined
}

const RANDOM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
let userQuestionsWarned = false

function createSessionId(): string {
  let suffix = ""
  for (let i = 0; i < 8; i += 1) suffix += RANDOM_CHARS[randomInt(RANDOM_CHARS.length)]
  return `oct-${suffix}`
}

function degradedHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  let pathname = "/"
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname
  } catch {
    pathname = "/"
  }
  const sub = pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname
  const isUp = sub.split("/").filter(Boolean)[0] === "up"
  res.writeHead(503, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(isUp ? { ok: false } : { error: "agent service unavailable" }))
  return Promise.resolve()
}

function registerRoute(ctx: Context, manager: AgentManager | null): () => void {
  const webServer = ctx.get("webServer") as WebServerLike
  const handler = manager
    ? createAgentApi({ manager, listPresets: () => resolvePresets(ctx) })
    : degradedHandler
  const disposeRoute = webServer.register({ kind: "prefix", path: BASE_PATH, handler })
  return () => { disposeRoute() }
}

interface SystemPromptLike {
  assemble(context?: unknown): Promise<{
    sections?: unknown[]
    contexts?: unknown[]
  }>
}

interface AgentPresetsLike {
  list(): Promise<{ id: string; name?: string; description?: string }[]>
  defaultId: string
}

async function resolvePresets(ctx: Context): Promise<{ items: PresetInfo[]; defaultId: string | null }> {
  try {
    const presets = ctx.get("agentPresets") as AgentPresetsLike | undefined
    if (!presets?.defaultId) return { items: [], defaultId: null }
    const items = await presets
      .list()
      .then((list) => list.map((p) => ({ id: p.id, name: p.name, description: p.description })))
      .catch(() => [] as PresetInfo[])
    if (items.length === 0) return { items: [], defaultId: presets.defaultId }
    return { items, defaultId: presets.defaultId }
  } catch {
    return { items: [], defaultId: null }
  }
}

export async function apply(ctx: Context, config: Partial<AgentConfig> = {}): Promise<void> {
  const dshHomePath = ctx.get("dshHomePath") as ((...segs: string[]) => string) | undefined
  if (typeof dshHomePath === "function") {
    try {
      ensureUserPresets(dshHomePath(".agent-presets"))
    } catch (error) {
      console.warn("[octopus-agent] user presets write failed:", error)
    }
  }
  if (!userQuestionsWarned) {
    userQuestionsWarned = true
    console.warn("[octopus-agent] ask_user_question bridge inactive: the web profile owns the global user-questions provider")
  }
  const persistence: PersistenceLike | undefined = ctx.get("sessionPersistence")
  if (!persistence) {
    console.error("[octopus-agent] sessionPersistence unavailable")
    ctx.effect(() => registerRoute(ctx, null))
    return
  }
  const defaultModel = ctx.get("agentDefaultModel") as DefaultModelLike | undefined
  const selection = typeof defaultModel?.currentSelection === "function" ? defaultModel.currentSelection() : undefined
  const systemPromptService = ctx.get("systemPrompt") as SystemPromptLike | undefined
  const systemPrompt = systemPromptService
    ? {
        assemble: async (agent: unknown) => {
          const assembly = await systemPromptService.assemble({ agent, scope: agent } as never)
          return { prompt: renderPrompt(assembly as never), context: renderContextSnapshot(assembly as never) }
        },
      }
    : undefined
  const manager = new AgentManager({
    agents: ctx.get("agents") as AgentsLike,
    persistence,
    sessionIdFactory: createSessionId,
    defaultCwd: config.defaultCwd ?? process.cwd(),
    defaultAgentPreset: config.defaultAgentPreset ?? "standard",
    provider: config.provider ?? selection?.provider,
    model: config.model ?? selection?.model,
    idleTtlMs: config.idleTtlMs ?? 30 * 60 * 1000,
    systemPrompt,
    personas: USER_PRESETS.map((p) => ({ presetId: p.id, sectionName: "deployment:persona", order: 0, text: p.persona })),
  })
  ctx.effect(() => {
    const disposeRoute = registerRoute(ctx, manager)
    return () => {
      disposeRoute()
      void manager.withdraw()
    }
  })
}

export default { name, inject, Config, apply }
