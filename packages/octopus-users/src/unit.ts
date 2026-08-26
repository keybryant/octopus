import type { KvUnitDescriptor, KvUnit, StorageBackend } from "@deepseek-ai/dsh-storage"

export const USERS_UNIT_DESCRIPTOR: KvUnitDescriptor = {
  name: "octopus-users",
  version: 1,
  tables: ["users", "sessions"],
  hasGlobal: false,
}

export function openUsersUnit(backend: StorageBackend): Promise<KvUnit> {
  if (!backend.kv) throw new Error("[octopus-users] storage backend 不支持 kv facet")
  return backend.kv.open(USERS_UNIT_DESCRIPTOR)
}
