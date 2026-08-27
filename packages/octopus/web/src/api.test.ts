import { afterEach, describe, expect, it, vi } from "vitest"
import { createProject, deleteProject, fetchProjects, fetchProjectsConfig, updateProject } from "./api"

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

afterEach(() => { vi.unstubAllGlobals() })

describe("projects api client", () => {
  it("fetchProjects maps items; null on http error and network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ items: [{ id: "p1", name: "A", description: "", status: "active", workspacePath: "/", workspaceId: "w", createdAt: "2026-01-01T00:00:00.000Z" }] })))
    expect(await fetchProjects()).toHaveLength(1)

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    expect(await fetchProjects()).toBeNull()

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    expect(await fetchProjects()).toBeNull()
  })

  it("fetchProjectsConfig returns defaultWorkspaceRoot or null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ defaultWorkspaceRoot: "/workspaces" })))
    expect(await fetchProjectsConfig()).toEqual({ defaultWorkspaceRoot: "/workspaces" })

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    expect(await fetchProjectsConfig()).toBeNull()
  })

  it("createProject posts json and returns project or null", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST")
      expect(JSON.parse(String(init?.body))).toEqual({ name: "A", description: "d" })
      return okResponse({ project: { id: "p9", name: "A", description: "d", status: "active", workspacePath: "/", workspaceId: "w", createdAt: "t" } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const created = await createProject({ name: "A", description: "d" })
    expect(created?.id).toBe("p9")

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) })))
    expect(await createProject({ name: "A" })).toBeNull()
  })

  it("updateProject/deleteProject report success via boolean", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(["PATCH", "DELETE"]).toContain(init?.method)
      return okResponse({})
    })
    vi.stubGlobal("fetch", fetchMock)
    expect(await updateProject("p1", { status: "done" })).toBe(true)
    expect(await deleteProject("p1")).toBe(true)

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("x") }))
    expect(await updateProject("p1", {})).toBe(false)
    expect(await deleteProject("p1")).toBe(false)
  })
})
