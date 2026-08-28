import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"

export const name = "octopus-agent"
export const inject = ["webServer"]

export const Config = z.object({
  defaultCwd: z.string().required(false),
  defaultAgentPreset: z.string().default("standard"),
  provider: z.string().required(false),
  model: z.string().required(false),
  idleTtlMs: z.number().default(30 * 60 * 1000),
})

export function apply(ctx: Context, config: Partial<typeof Config> = {}) {
  void ctx
  void config
}
