import { describe, expect, it } from "vitest"
import type { ProjectsTableLike } from "./api.js"
import { createProjectStore } from "./service.js"

function fakeTable(records: Record<string, Parameters<ProjectsTableLike["put"]>[1]>): ProjectsTableLike {
  return {
    get: (id) => records[id],
    entries: function* () {
      for (const [id, record] of Object.entries(records)) yield [id, record]
    },
    put: async () => {},
    delete: async () => true,
  }
}

const BASE = {
  name: "Alpha",
  description: "",
  status: "active" as const,
  workspacePath: "C:/projects/alpha",
  workspaceId: "ws-1",
  createdAt: "2026-08-26T00:00:00.000Z",
}

describe("createProjectStore", () => {
  it("list 返回 id+record 视图，按 createdAt 倒序", () => {
    const store = createProjectStore(fakeTable({
      "prjA": { ...BASE, name: "Alpha", createdAt: "2026-08-26T00:00:00.000Z" },
      "prjB": { ...BASE, name: "Beta", createdAt: "2026-08-27T00:00:00.000Z" },
    }))
    const items = store.list()
    expect(items.map((p) => p.id)).toEqual(["prjB", "prjA"])
    expect(items[0]).toMatchObject({ id: "prjB", name: "Beta", workspacePath: "C:/projects/alpha" })
  })

  it("get 返回带 id 的视图；未知 id 返回 undefined", () => {
    const store = createProjectStore(fakeTable({ "prjA": { ...BASE } }))
    expect(store.get("prjA")?.id).toBe("prjA")
    expect(store.get("prjZ")).toBeUndefined()
  })
})
