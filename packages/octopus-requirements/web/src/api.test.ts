import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRequirement, currentProjectId, listRequirements, removeRequirement, updateRequirement } from "./api"

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, search: "" })
})

afterEach(() => {
  delete (window as unknown as { __octopusProjectId?: string }).__octopusProjectId
  vi.unstubAllGlobals()
})

describe("web api", () => {
  it("listRequirements 请求列表并返回数据（projectId 必带）", async () => {
    const data = [{ id: "REQ-100", title: "A" }]
    vi.stubGlobal("fetch", mockFetchOnce(200, { ok: true, data }))
    const result = await listRequirements({ projectId: "p-alpha", status: "backlog" })
    expect(result).toEqual(data)
    expect(fetch).toHaveBeenCalledWith(
      "/api/octopus-requirements/requirements?projectId=p-alpha&status=backlog",
      expect.objectContaining({ headers: { "content-type": "application/json" } }),
    )
  })

  it("list 未显式传 projectId 时回退到宿主注入值", async () => {
    ;(window as unknown as { __octopusProjectId?: string }).__octopusProjectId = "p-beta"
    vi.stubGlobal("fetch", mockFetchOnce(200, { ok: true, data: [] }))
    await listRequirements()
    expect(fetch).toHaveBeenCalledWith(
      "/api/octopus-requirements/requirements?projectId=p-beta",
      expect.anything(),
    )
    expect(currentProjectId()).toBe("p-beta")
  })

  it("createRequirement POST 序列化 body 并注入 projectId", async () => {
    ;(window as unknown as { __octopusProjectId?: string }).__octopusProjectId = "p-alpha"
    vi.stubGlobal("fetch", mockFetchOnce(201, { ok: true, data: { id: "REQ-100" } }))
    await createRequirement({ title: "A", priority: "P0" })
    expect(fetch).toHaveBeenCalledWith(
      "/api/octopus-requirements/requirements",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "A", priority: "P0", projectId: "p-alpha" }),
      }),
    )
  })

  it("updateRequirement PATCH 编码 id", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, { ok: true, data: { id: "REQ-100", status: "planned" } }))
    await updateRequirement("REQ-100", { status: "planned" })
    expect(fetch).toHaveBeenCalledWith(
      "/api/octopus-requirements/requirements/REQ-100",
      expect.objectContaining({ method: "PATCH" }),
    )
  })

  it("removeRequirement DELETE", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, { ok: true, data: true }))
    expect(await removeRequirement("REQ-100")).toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      "/api/octopus-requirements/requirements/REQ-100",
      expect.objectContaining({ method: "DELETE" }),
    )
  })

  it("业务错误抛出 message", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(422, { ok: false, error: { code: "invalid-transition", message: "invalid status transition" } }),
    )
    await expect(updateRequirement("REQ-100", { status: "done" })).rejects.toThrow(
      "invalid status transition",
    )
  })

  it("网络失败给出可读提示", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))
    await expect(listRequirements()).rejects.toThrow(/无法连接服务/)
  })
})
