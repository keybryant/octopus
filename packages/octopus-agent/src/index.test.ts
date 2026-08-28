import { describe, expect, it } from "vitest"
import { Config, inject, name } from "./index.js"

describe("octopus-agent plugin", () => {
  it("declares plugin identity and webServer inject", () => {
    expect(name).toBe("octopus-agent")
    expect(inject).toEqual(["webServer"])
  })
  it("config has defaults", () => {
    const cfg = Config()
    expect(cfg.defaultAgentPreset).toBe("standard")
    expect(cfg.idleTtlMs).toBe(30 * 60 * 1000)
  })
})
