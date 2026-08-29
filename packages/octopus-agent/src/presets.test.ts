import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ensureUserPresets, USER_PRESETS } from "./presets.js"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "octopus-presets-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("ensureUserPresets", () => {
  it("writes one preset per definition with metadata and persona", () => {
    const ids = ensureUserPresets(root)
    expect(ids).toEqual(USER_PRESETS.map((p) => p.id))
    expect(readdirSync(root).sort()).toEqual(USER_PRESETS.map((p) => p.id).sort())
    for (const preset of USER_PRESETS) {
      const meta = readFileSync(join(root, preset.id, "preset.yml"), "utf8")
      expect(meta).toContain(`name: ${preset.name}`)
      expect(meta).toContain(`description: ${preset.description}`)
      const composition = readFileSync(join(root, preset.id, "agent.cordis.yml"), "utf8")
      expect(composition).toContain(preset.persona)
      expect(composition).not.toContain("__OCTOPUS_PERSONA__")
    }
  })
})
