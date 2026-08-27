import { describe, expect, it } from "vitest"
import type { KvUnitDescriptor, KvUnit, StorageBackend } from "@deepseek-ai/dsh-storage"
import { openUsersUnit } from "./unit.js"

export function createFakeBackend(): StorageBackend & { units: Map<string, KvUnit> } {
  const units = new Map<string, KvUnit>()
  return {
    units,
    close: async () => undefined,
    kv: {
      async open(descriptor: KvUnitDescriptor) {
        if (units.has(descriptor.name)) throw new Error("already-open")
        const tables: Record<string, Record<string, unknown>> = {}
        for (const t of descriptor.tables) tables[t] = {}
        const unit: KvUnit = {
          async loadAll() {
            return { tables: structuredClone(tables), global: null }
          },
          async putRecord(table, key, value) {
            tables[table][key] = structuredClone(value)
          },
          async deleteRecord(table, key) {
            delete tables[table][key]
          },
          async setGlobal() {
            throw new Error("hasGlobal=false")
          },
          async close() {
            units.delete(descriptor.name)
          },
        }
        units.set(descriptor.name, unit)
        return unit
      },
    },
  }
}

describe("openUsersUnit", () => {
  it("使用固定描述符打开单元", async () => {
    const backend = createFakeBackend()
    const unit = await openUsersUnit(backend)
    const snapshot = await unit.loadAll()
    expect(Object.keys(snapshot.tables).sort()).toEqual(["sessions", "users"])
  })

  it("后端不支持 kv facet 时报错", () => {
    expect(() => openUsersUnit({ close: async () => undefined } as StorageBackend)).toThrow(/kv facet/)
  })
})
