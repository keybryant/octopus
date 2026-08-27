import { describe, expect, it } from "vitest"
import plugin, { inject, name } from "./index.js"

describe("octopus-tasks plugin", () => {
  it("导出插件元信息", () => {
    expect(name).toBe("octopus-tasks")
    expect(inject).toEqual(["workbench", "webServer", "storageDomain"])
    expect(plugin.name).toBe("octopus-tasks")
  })
})
