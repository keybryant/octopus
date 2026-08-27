import { mkdtempSync, rmSync } from "node:fs"
import { stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, BASE_PATH, createProjectsHandler, type ApiResponse, type ProjectsTableLike, type WorkspaceRegistryLike } from "./api.js"
import type { ProjectRecord } from "./domain.js"

function makeTable(seed: Record<string, ProjectRecord> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    get: vi.fn((id: string) => map.get(id)),
    entries: vi.fn(() => map.entries()),
    put: vi.fn(async (id: string, value: ProjectRecord) => { map.set(id, value) }),
    delete: vi.fn(async (id: string) => map.delete(id)),
    peek: () => map,
  } satisfies Omit<ProjectsTableLike, "entries"> & { entries: () => IterableIterator<[string, ProjectRecord]>; peek: () => Map<string, ProjectRecord> }
}

function makeWorkspaces() {
  return { create: vi.fn(async (path: string, title?: string) => ({ id: `ws-${title ?? path}` })) }
}

let rootDir = ""

beforeEach(() => { rootDir = mkdtempSync(join(tmpdir(), "octopus-projects-api-")) })
afterEach(() => rmSync(rootDir, { recursive: true, force: true }))

function req(method: string, subPath: string, bodyJson?: unknown) {
  return {
    method,
    url: `${BASE_PATH}${subPath}`,
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!bodyJson) return
      if (event === "data") listener(JSON.stringify(bodyJson))
      if (event === "end") listener()
    },
  }
}

function res() {
  const calls: { status: number; body: string }[] = []
  let current = ""
  return {
    calls,
    writeHead(status: number) { current = String(status); calls.push({ status, body: "" }) },
    end(body?: string | Uint8Array) { void current; if (calls.length > 0) calls[calls.length - 1].body += String(body ?? "") },
  } satisfies ApiResponse & { calls: { status: number; body: string }[] }
}

async function post(deps: Parameters<typeof createProjectsHandler>[0], body: unknown) {
  const r = res()
  await createProjectsHandler(deps)(req("POST", "/projects", body), r)
  return r.calls[0]
}

describe("createProjectsHandler", () => {
  it("GET /config returns resolved root", async () => {
    const handler = createProjectsHandler({ defaultRoot: rootDir, projects: makeTable(), workspaces: makeWorkspaces() })
    const r = res()
    await handler(req("GET", "/config"), r)
    expect(r.calls[0].status).toBe(200)
    expect(JSON.parse(r.calls[0].body).defaultWorkspaceRoot).toBe(rootDir)
  })

  it("POST creates dir, registers workspace and stores record", async () => {
    const table = makeTable()
    const workspaces = makeWorkspaces()
    const call = await post({ defaultRoot: rootDir, projects: table, workspaces }, { name: "My Proj", description: "d", status: "paused" })
    expect(call.status).toBe(201)
    const view = JSON.parse(call.body).project
    const expectedDir = join(rootDir, "My Proj")
    expect(await stat(expectedDir)).toBeTruthy()
    expect(workspaces.create).toHaveBeenCalledWith(expectedDir, "My Proj")
    expect(view.name).toBe("My Proj")
    expect(view.status).toBe("paused")
    expect(view.workspacePath).toBe(expectedDir)
    expect(view.workspaceId).toBe("ws-My Proj")
    expect(view.id).toMatch(/^prj[A-Z]{4}$/)
    expect(new Date(view.createdAt).toString()).not.toBe("Invalid Date")
  })

  it("POST generates unique prj id, retrying on collision", async () => {
    const seed: Record<string, ProjectRecord> = {
      "prjCCCC": { name: "occupied", description: "", status: "active", workspacePath: "/p/occupied", workspaceId: "w", createdAt: "2026-01-01T00:00:00.000Z" },
    }
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.1).mockReturnValueOnce(0.1).mockReturnValueOnce(0.1).mockReturnValueOnce(0.1)
      .mockReturnValue(0.9)
    try {
      const call = await post({ defaultRoot: rootDir, projects: makeTable(seed), workspaces: makeWorkspaces() }, { name: "unique" })
      expect(call.status).toBe(201)
      const view = JSON.parse(call.body).project
      expect(view.id).toBe("prjXXXX")
    } finally {
      random.mockRestore()
    }
  })

  it("POST defaults description/status when omitted", async () => {
    const call = await post({ defaultRoot: rootDir, projects: makeTable(), workspaces: makeWorkspaces() }, { name: "bare" })
    const view = JSON.parse(call.body).project
    expect(view.description).toBe("")
    expect(view.status).toBe("active")
  })

  it("POST rejects invalid names and bad status with 400", async () => {
    const deps = { defaultRoot: rootDir, projects: makeTable(), workspaces: makeWorkspaces() }
    for (const name of ["", "a/b", "..", "x".repeat(65)]) {
      expect((await post(deps, { name })).status).toBe(400)
    }
    expect((await post(deps, { name: "ok", status: "running" })).status).toBe(400)
  })

  it("POST returns 409 when directory exists and skips creation", async () => {
    const table = makeTable()
    const workspaces = makeWorkspaces()
    const deps = { defaultRoot: rootDir, projects: table, workspaces }
    await post(deps, { name: "dup" })
    const second = await post(deps, { name: "dup" })
    expect(second.status).toBe(409)
    expect(workspaces.create).toHaveBeenCalledTimes(1)
  })

  it("POST maps workspace failure to 409", async () => {
    const workspaces = { create: vi.fn(async () => { throw new Error("boom") }) }
    const call = await post({ defaultRoot: rootDir, projects: makeTable(), workspaces }, { name: "ws-fail" })
    expect(call.status).toBe(409)
  })

  it("GET /projects lists by createdAt desc", async () => {
    const seed: Record<string, ProjectRecord> = {
      "id-old": { name: "old", description: "", status: "active", workspacePath: "/p/old", workspaceId: "w1", createdAt: "2026-01-01T00:00:00.000Z" },
      "id-new": { name: "new", description: "", status: "done", workspacePath: "/p/new", workspaceId: "w2", createdAt: "2026-02-01T00:00:00.000Z" },
    }
    const r = res()
    await createProjectsHandler({ defaultRoot: rootDir, projects: makeTable(seed), workspaces: makeWorkspaces() })(req("GET", "/projects"), r)
    const items = JSON.parse(r.calls[0].body).items
    expect(items.map((i: { id: string }) => i.id)).toEqual(["id-new", "id-old"])
  })

  it("PATCH updates only given fields; unknown id 404; bad status 400", async () => {
    const seed: Record<string, ProjectRecord> = {
      "id-1": { name: "p", description: "old", status: "active", workspacePath: "/p/p", workspaceId: "w", createdAt: "2026-01-01T00:00:00.000Z" },
    }
    const deps = { defaultRoot: rootDir, projects: makeTable(seed), workspaces: makeWorkspaces() }
    const r = res()
    await createProjectsHandler(deps)(req("PATCH", "/projects/id-1", { status: "archived" }), r)
    expect(r.calls[0].status).toBe(200)
    const view = JSON.parse(r.calls[0].body).project
    expect(view.status).toBe("archived")
    expect(view.description).toBe("old")

    const miss = res()
    await createProjectsHandler(deps)(req("PATCH", "/projects/nope", { status: "active" }), miss)
    expect(miss.calls[0].status).toBe(404)

    const bad = res()
    await createProjectsHandler(deps)(req("PATCH", "/projects/id-1", { status: "nope" }), bad)
    expect(bad.calls[0].status).toBe(400)
  })

  it("DELETE removes record; unknown id 404", async () => {
    const seed: Record<string, ProjectRecord> = {
      "id-1": { name: "p", description: "", status: "active", workspacePath: "/p/p", workspaceId: "w", createdAt: "2026-01-01T00:00:00.000Z" },
    }
    const deps = { defaultRoot: rootDir, projects: makeTable(seed), workspaces: makeWorkspaces() }
    const ok = res()
    await createProjectsHandler(deps)(req("DELETE", "/projects/id-1"), ok)
    expect(ok.calls[0].status).toBe(200)
    expect(JSON.parse(ok.calls[0].body).deleted).toBe(true)

    const miss = res()
    await createProjectsHandler(deps)(req("DELETE", "/projects/id-1"), miss)
    expect(miss.calls[0].status).toBe(404)
  })

  it("unknown path 404, wrong method 405, malformed json 400", async () => {
    const handler = createProjectsHandler({ defaultRoot: rootDir, projects: makeTable(), workspaces: makeWorkspaces() })
    const nf = res(); await handler(req("GET", "/whatever"), nf); expect(nf.calls[0].status).toBe(404)
    const mna = res(); await handler(req("PUT", "/projects"), mna); expect(mna.calls[0].status).toBe(405)
    const bad = res(); await handler({ method: "POST", url: `${BASE_PATH}/projects`, on(ev, l) { if (ev === "data") l("{oops"); if (ev === "end") l() } }, bad)
    expect(bad.calls[0].status).toBe(400)
  })
})
