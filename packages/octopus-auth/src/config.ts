import z from "@deepseek-ai/schemastery"

export interface AuthResolvedConfig {
  mode: "single-user" | "multi-user"
  backend: string
  secureCookie: boolean
  sessionTtlDays: number
  trustProxy: boolean
  bootstrapAdmin?: { username: string; password: string }
}

export const DEFAULT_AUTH_CONFIG: AuthResolvedConfig = {
  mode: "multi-user",
  backend: "json",
  secureCookie: false,
  sessionTtlDays: 7,
  trustProxy: false,
}

export const AuthConfigSchema = z.object({
  mode: z.union([z.const("single-user"), z.const("multi-user")]).default(DEFAULT_AUTH_CONFIG.mode),
  backend: z.string().default(DEFAULT_AUTH_CONFIG.backend),
  secureCookie: z.boolean().default(DEFAULT_AUTH_CONFIG.secureCookie),
  sessionTtlDays: z.number().min(1).default(DEFAULT_AUTH_CONFIG.sessionTtlDays),
  trustProxy: z.boolean().default(DEFAULT_AUTH_CONFIG.trustProxy),
  bootstrapAdmin: z.object({
    username: z.string(),
    password: z.string(),
  }),
})

export function resolveAuthConfig(partial: Partial<AuthResolvedConfig> = {}): AuthResolvedConfig {
  return { ...DEFAULT_AUTH_CONFIG, ...partial }
}
