import { randomInt } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { renderContextSnapshot, renderPrompt } from "@deepseek-ai/dsh-system-prompt"
import { MONITOR_HALT_EVENT, type AgentMonitorHaltEvent } from "octopus-agent-monitor"
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
  // 空闲回收默认放宽到 24h：工作台会话（PM/子任务）数量有限，避免会话在一天内被回收丢失标题/实时态
  idleTtlMs: z.number().default(24 * 60 * 60 * 1000),
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

type PresetModelSpec = { provider?: string; model?: string }

/** 预设计模型覆盖（.agent-presets/agent-models.json，与 user presets 同目录） */
function loadPresetModels(file: string): Map<string, PresetModelSpec> {
  const map = new Map<string, PresetModelSpec>()
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, { provider?: string; model?: string }>
    for (const [id, spec] of Object.entries(raw ?? {})) {
      if (spec && (typeof spec.provider === "string" || typeof spec.model === "string")) {
        map.set(id, { provider: spec.provider, model: spec.model })
      }
    }
  } catch {
    /* 文件缺失或损坏 → 空映射 */
  }
  return map
}

function savePresetModels(file: string, map: Map<string, PresetModelSpec>): void {
  try {
    writeFileSync(file, JSON.stringify(Object.fromEntries(map), null, 2))
  } catch (error) {
    console.warn("[octopus-agent] preset models save failed:", error)
  }
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
    ? createAgentApi({ manager, listPresets: () => resolvePresets(ctx, (id) => manager.presetModelOf(id)) })
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

async function resolvePresets(
  ctx: Context,
  modelOf?: (presetId: string) => PresetModelSpec | undefined,
): Promise<{ items: PresetInfo[]; defaultId: string | null }> {
  try {
    const presets = ctx.get("agentPresets") as AgentPresetsLike | undefined
    if (!presets?.defaultId) return { items: [], defaultId: null }
    const items = await presets
      .list()
      .then((list) =>
        list.map((p) => {
          const model = modelOf?.(p.id)
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            provider: model?.provider,
            model: model?.model,
          }
        }),
      )
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
  // 预设模型覆盖：同一 .agent-presets 目录下的 agent-models.json
  const presetModelsFile = typeof dshHomePath === "function" ? join(dshHomePath(".agent-presets"), "agent-models.json") : null
  const presetModels = loadPresetModels(presetModelsFile ?? "\0")
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
  const agentMonitor = ctx.get("agentMonitor") as
    | { resume(sessionId: string): void }
    | undefined
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
    idleTtlMs: config.idleTtlMs ?? 24 * 60 * 60 * 1000,
    presetModels,
    ...(presetModelsFile !== null ? { savePresetModels: () => savePresetModels(presetModelsFile, presetModels) } : {}),
    systemPrompt,
    agentMonitor,
    personas: USER_PRESETS.map((p) => ({ presetId: p.id, sectionName: "deployment:persona", order: 0, text: p.persona })),
    roles: USER_PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description })),
  })
  ctx.effect(() => {
    // 共享给 octopus-workflow：任务子会话按 task.agent 预设取同一份模型覆盖
    ctx.provide("agentPresetModels", { get: (presetId: string) => manager.presetModelOf(presetId) })
    const disposeRoute = registerRoute(ctx, manager)
    // 监控停机事件 → 聊天问题横幅（等待用户决策继续/停止）
    const offMonitorHalted = ctx.on(MONITOR_HALT_EVENT, (payload: AgentMonitorHaltEvent) => {
      manager.handleMonitorHalted(payload)
    })
    return () => {
      disposeRoute()
      offMonitorHalted()
      void manager.withdraw()
    }
  })
}

export default { name, inject, Config, apply }
