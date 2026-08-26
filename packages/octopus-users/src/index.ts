import type { Context } from "@deepseek-ai/cordis"
import type { StorageBackend } from "@deepseek-ai/dsh-storage"
import { createUsersService, type UsersService } from "./service.js"
import { USERS_UNIT_DESCRIPTOR, openUsersUnit } from "./unit.js"
import { WriteChain } from "./write-chain.js"
import { UsersError } from "./types.js"

export { createUsersService, type UsersService }
export { USERS_UNIT_DESCRIPTOR, openUsersUnit }
export { WriteChain }
export { UsersError }
export type { SessionRecord, UserRecord, UsersErrorCode } from "./types.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    users: UsersService
  }
}

export const name = "octopus-users"
export const inject = ["storage"] as const

interface StorageLike {
  backend: { get(name: string): StorageBackend }
}

export function apply(ctx: Context) {
  const storage = (ctx as unknown as { storage: StorageLike }).storage
  const service = createUsersService(storage.backend.get("json"))
  ctx.provide("users", service)
  ctx.effect(() => () => {
    void service.close()
  })
}

export default { name, inject, apply }
