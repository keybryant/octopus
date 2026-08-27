import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG, isValidProjectName, projectsDomainSpec, resolveDefaultWorkspaceRoot } from "./domain.js"

describe("isValidProjectName", () => {
  it("accepts normal names and trims whitespace", () => {
    expect(isValidProjectName("Octopus Platform")).toBe(true)
    expect(isValidProjectName("  数据中台  ")).toBe(true)
    expect(isValidProjectName("a".repeat(64))).toBe(true)
  })
  it("rejects empty, too long, dot-only names", () => {
    expect(isValidProjectName("")).toBe(false)
    expect(isValidProjectName("   ")).toBe(false)
    expect(isValidProjectName("a".repeat(65))).toBe(false)
    expect(isValidProjectName(".")).toBe(false)
    expect(isValidProjectName("..")).toBe(false)
  })
  it("rejects path separators and windows-forbidden chars", () => {
    for (const bad of ["a/b", "a\\b", "a:b", 'a"b', "a<b", "a>b", "a|b", "a?b", "a*b", "a\x01b"]) {
      expect(isValidProjectName(bad)).toBe(false)
    }
  })
})

describe("resolveDefaultWorkspaceRoot", () => {
  it("expands ~ to home dir", () => {
    expect(resolveDefaultWorkspaceRoot("~")).toBe(homedir())
    expect(resolveDefaultWorkspaceRoot("~/octopus-projects")).toBe(join(homedir(), "octopus-projects"))
  })
  it("falls back to default when empty/undefined", () => {
    expect(resolveDefaultWorkspaceRoot(undefined)).toBe(join(homedir(), "octopus-projects"))
    expect(resolveDefaultWorkspaceRoot("   ")).toBe(join(homedir(), DEFAULT_CONFIG.defaultWorkspaceRoot.slice(2)))
  })
  it("resolves absolute and relative paths against cwd", () => {
    expect(resolveDefaultWorkspaceRoot("/tmp/proj")).toBe(resolve("/tmp/proj"))
    expect(resolveDefaultWorkspaceRoot("rel/dir")).toBe(resolve("rel/dir"))
  })
})

describe("projectsDomainSpec", () => {
  it("declares projects table with version 1", () => {
    expect(projectsDomainSpec.name).toBe("projects")
    expect(projectsDomainSpec.version).toBe(1)
    expect(Object.keys(projectsDomainSpec.tables)).toEqual(["projects"])
  })
})
