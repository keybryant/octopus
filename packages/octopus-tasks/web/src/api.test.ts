import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createTask,
  createTaskBatch,
  currentProjectId,
  decomposeTasks,
  listTasks,
  removeTask,
  updateTask,
} from "./api"

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
  it("listTasks 请求列表（projectId 必带，支持 requirementId 过滤）", async () => {
    const data = [{ id: "TASK-2800", title: "A" }]
    vi.stubGlobal("fetch", mockFetchOnce(200, { ok: true, data }))
    const result = await listTasks({ projectId: "p-alpha", requirementId: "REQ-100" })
    expect(result).toEqual(data)
    expect(fetch).toHaveBeenCalledWith(
      "/api/octopus-tasks/tasks?projectId=p-alpha&requirementId=REQ-100",
      expect.objectContaining({ headers: { "content-type": "application/json" } }),
    )
  })

  it("list 未显式传 projectId 时回退宿主注入值", async () => {
    ;(window as unknown as { __octopusProjectId?: string }).__octopusProjectId = "p-beta"
    vi.stubGlobal("fetch", mockFetchOnce(200, { ok: true, data: [] }))
    await listTasks()
    expect(fetch).toHaveBeenCalledWith("/api/octopus-tasks/tasks?projectId=p-beta", expect.anything())
    expect(currentProjectId()).toBe("p-beta")
  })

  it("createTaskBatch POST /batch 序列化 body 并注入 projectId", async () => {
    ;(window as unknown as { __octopusProjectId?: string }).__octopusProjectId = "p-alpha"
    vi.stubGlobal("fetch", mockFetchOnce(201, { ok: true, data: [{ id: "TASK-2800" }] }))
    await createTaskBatch({ requirementId: "REQ-100", tasks: [{ title: "A" }] })
    expect(fetch).toHaveBeenCalledWith(
      "/api/octopus-tasks/tasks/batch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ requirementId: "REQ-100", projectId: "p-alpha", tasks: [{ title: "A" }] }),
      }),
    )
  })

  it("decomposeTasks 返回草稿数组", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, {
      ok: true,
      data: { drafts: [{ title: "实现A" }, { title: "A 联调" }] },
    }))
    const drafts = await decomposeTasks({ requirementId: "REQ-100", title: "A" })
    expect(drafts).toEqual([{ title: "实现A" }, { title: "A 联调" }])
    expect(fetch).toHaveBeenCalledWith(
      "/api/octopus-tasks/tasks/decompose",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("updateTask PATCH 编码 id；removeTask DELETE", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, { ok: true, data: { id: "TASK-2800", status: "doing" } }))
    await updateTask("TASK-2800", { status: "doing" })
    expect(fetch).toHaveBeenCalledWith(
      "/api/octopus-tasks/tasks/TASK-2800",
      expect.objectContaining({ method: "PATCH" }),
    )

    vi.stubGlobal("fetch", mockFetchOnce(200, { ok: true, data: true }))
    expect(await removeTask("TASK-2800")).toBe(true)
  })

  it("业务错误抛出 message；网络失败给出可读提示", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(422, { ok: false, error: { code: "invalid-transition", message: "invalid status transition" } }))
    await expect(updateTask("TASK-2800", { status: "done" })).rejects.toThrow("invalid status transition")

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))
    await expect(listTasks()).rejects.toThrow(/无法连接服务/)
  })
})
