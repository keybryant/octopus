import { randomInt } from "node:crypto"
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { createAgentApi, BASE_PATH, type ApiRequest, type ApiResponse } from "./api.js"
import { AgentManager, type AgentsLike, type PersistenceLike } from "./manager.js"

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

interface QuestionOptionLike {
  label?: string
  value?: string
}

interface QuestionItemLike {
  id: string
  question: string
  options?: (string | QuestionOptionLike)[]
}

interface UserQuestionsAsk {
  questions?: QuestionItemLike[]
  agent?: { id?: string } | null
  signal?: AbortSignal
}

interface UserQuestionsProvider {
  ask(request: UserQuestionsAsk): Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>
}

interface UserQuestionsLike {
  registerProvider(provider: UserQuestionsProvider): unknown
}

const RANDOM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

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
  const handler = manager ? createAgentApi({ manager }) : degradedHandler
  const disposeRoute = webServer.register({ kind: "prefix", path: BASE_PATH, handler })
  return () => { disposeRoute() }
}

function bridgeUserQuestions(ctx: Context, manager: AgentManager): void {
  const userQuestions = ctx.get("userQuestions") as UserQuestionsLike | undefined
  if (!userQuestions) return
  try {
    userQuestions.registerProvider({
      ask(request) {
        const sessionId = request.agent?.id
        if (typeof sessionId !== "string") {
          return Promise.reject(new Error("[octopus-agent] question without agent"))
        }
        const items = request.questions ?? []
        if (items.length === 0) return Promise.resolve({ answers: [] })
        if (items.length > 1) console.error("[octopus-agent] multiple questions asked at once; bridging only the first")
        const first = items[0]
        return manager.beginQuestion(sessionId, {
          callerItemId: first.id,
          question: first.question,
          options: (first.options ?? []).map((option) =>
            typeof option === "string" ? option : String(option.label ?? option.value ?? option),
          ),
        }).answerPromise
      },
    })
  } catch (error) {
    console.error("[octopus-agent] userQuestions provider registration failed", error)
  }
}

export async function apply(ctx: Context, config: Partial<AgentConfig> = {}): Promise<void> {
  const persistence: PersistenceLike | undefined = ctx.get("sessionPersistence")
  if (!persistence) {
    console.error("[octopus-agent] sessionPersistence unavailable")
    ctx.effect(() => registerRoute(ctx, null))
    return
  }
  const defaultModel = ctx.get("agentDefaultModel") as DefaultModelLike | undefined
  const selection = typeof defaultModel?.currentSelection === "function" ? defaultModel.currentSelection() : undefined
  const manager = new AgentManager({
    agents: ctx.get("agents") as AgentsLike,
    persistence,
    sessionIdFactory: createSessionId,
    defaultCwd: config.defaultCwd ?? process.cwd(),
    defaultAgentPreset: config.defaultAgentPreset ?? "standard",
    provider: config.provider ?? selection?.provider,
    model: config.model ?? selection?.model,
    idleTtlMs: config.idleTtlMs ?? 30 * 60 * 1000,
  })
  bridgeUserQuestions(ctx, manager)
  ctx.effect(() => {
    const disposeRoute = registerRoute(ctx, manager)
    return () => {
      disposeRoute()
      void manager.withdraw()
    }
  })
}

export default { name, inject, Config, apply }
