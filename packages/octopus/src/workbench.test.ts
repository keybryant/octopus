import { describe, expect, it } from "vitest"
import { createRegistry } from "./workbench.js"

describe("createRegistry", () => {
  it("registers and lists a module", () => {
    const registry = createRegistry()
    const module = { id: "a", title: "A", entry: "/a.js" }
    registry.register(module)
    expect(registry.list()).toEqual([module])
  })

  it("sorts by order and keeps insertion order for ties", () => {
    const registry = createRegistry()
    registry.register({ id: "a", title: "A", order: 1, entry: "/a.js" })
    registry.register({ id: "b", title: "B", order: 0, entry: "/b.js" })
    registry.register({ id: "c", title: "C", order: 1, entry: "/c.js" })
    expect(registry.list().map((m) => m.id)).toEqual(["b", "a", "c"])
  })

  it("defaults missing order to 0", () => {
    const registry = createRegistry()
    const module = { id: "a", title: "A", entry: "/a.js" }
    registry.register(module)
    expect(registry.list()).toEqual([module])
  })

  it("rejects duplicate ids", () => {
    const registry = createRegistry()
    registry.register({ id: "a", title: "A", entry: "/a.js" })
    expect(() =>
      registry.register({ id: "a", title: "A2", entry: "/a2.js" }),
    ).toThrow(/duplicate/)
  })

  it("disposer removes the module", () => {
    const registry = createRegistry()
    const dispose = registry.register({ id: "a", title: "A", entry: "/a.js" })
    dispose()
    expect(registry.list()).toEqual([])
  })
})
