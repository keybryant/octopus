import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import Storage from "@deepseek-ai/dsh-storage"
import * as JsonStorage from "@deepseek-ai/dsh-storage-json"
import * as DomainStorage from "@deepseek-ai/dsh-storage-domain"
import { TaskStore } from "./store.js"

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "octopus-task-"))
  const ctx = new Context()
  await ctx.plugin(Storage as any)
  await ctx.plugin(JsonStorage as any, { root })
  await ctx.plugin(DomainStorage as any, { backend: "json" })
  const store = await TaskStore.open(ctx)
  return { ctx, root, store }
}

describe("TaskStore", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>
  let store: TaskStore

  beforeEach(async () => {
    harness = await createHarness()
    store = harness.store
  })

  afterEach(async () => {
    await store.close()
    await rm(harness.root, { recursive: true, force: true })
  })

  it("create 生成递增 id，默认从 TASK-2800 开始，todo 初始态", async () => {
    const first = await store.create({
      title: "  导出报表支持 CSV 格式  ",
      requirementId: "REQ-124",
      projectId: "p-alpha",
      description: "按月导出",
    })
    const second = await store.create({
      title: "审计日志分页优化",
      requirementId: "REQ-124",
      projectId: "p-alpha",
      description: "limit 后索引失效",
    })

    expect(first.id).toBe("TASK-2800")
    expect(first.title).toBe("导出报表支持 CSV 格式")
    expect(first.requirementId).toBe("REQ-124")
    expect(first.projectId).toBe("p-alpha")
    expect(first.status).toBe("todo")
    expect(first.description).toBe("按月导出")

    expect(second.id).toBe("TASK-2801")
    expect(second.description).toBe("limit 后索引失效")
    expect(second.createdAt).toBe(second.updatedAt)
  })

  it("create 拒绝空标题/ 空 requirementId / 空 projectId", async () => {
    await expect(store.create({ title: "   ", requirementId: "R", projectId: "p" })).rejects.toMatchObject({
      name: "TasksError", code: "invalid-input",
    })
    await expect(store.create({ title: "A", requirementId: "  ", projectId: "p" })).rejects.toMatchObject({ code: "invalid-input" })
    await expect(store.create({ title: "A", requirementId: "R", projectId: "" })).rejects.toMatchObject({ code: "invalid-input" })
  })

  it("并发 create 的 id 唯一（写链原子序号）", async () => {
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.create({ title: `任务 ${i}`, requirementId: "REQ-100", projectId: "p-alpha" }),
      ),
    )
    const ids = created.map((t) => t.id)
    expect(new Set(ids).size).toBe(20)
    expect(ids).toContain("TASK-2800")
    expect(ids).toContain("TASK-2819")
  })

  it("get/list 反映已写入记录（数值 id 序，支持项目过滤）", async () => {
    await store.create({ title: "A", requirementId: "R1", projectId: "p-alpha" })
    await store.create({ title: "B", requirementId: "R1", projectId: "p-beta" })

    expect(store.list().map((t) => t.id)).toEqual(["TASK-2800", "TASK-2801"])
    expect(store.list((t) => t.projectId === "p-alpha").map((t) => t.id)).toEqual(["TASK-2800"])
    expect(store.get("TASK-2800")?.title).toBe("A")
    expect(store.get("TASK-9999")).toBeUndefined()
  })

  it("update 支持字段修改与单向合法迁移，done 终态", async () => {
    const task = await store.create({ title: "A", requirementId: "REQ-1", projectId: "p-alpha" })

    const renamed = await store.update(task.id, { title: "A2" })
    expect(renamed.title).toBe("A2")

    expect((await store.update(task.id, { status: "doing" })).status).toBe("doing")
    expect((await store.update(task.id, { status: "review" })).status).toBe("review")
    expect((await store.update(task.id, { status: "done" })).status).toBe("done")
  })

  it("update 拒绝非法/回退迁移且状态不被污染", async () => {
    const task = await store.create({ title: "A", requirementId: "REQ-1", projectId: "p-alpha" })

    await expect(store.update(task.id, { status: "done" })).rejects.toMatchObject({ code: "invalid-transition" })
    expect(store.get(task.id)?.status).toBe("todo")

    await store.update(task.id, { status: "doing" })
    await expect(store.update(task.id, { status: "todo" })).rejects.toMatchObject({ code: "invalid-transition" })
    expect(store.get(task.id)?.status).toBe("doing")
  })

  it("update 拒绝空标题、空更新与不存在 id", async () => {
    const task = await store.create({ title: "A", requirementId: "REQ-1", projectId: "p-alpha" })
    await expect(store.update(task.id, { title: "   " })).rejects.toMatchObject({ code: "invalid-input" })
    await expect(store.update(task.id, {})).rejects.toMatchObject({ code: "invalid-input" })
    await expect(store.update("TASK-9999", { title: "x" })).rejects.toMatchObject({ code: "not-found" })
  })

  it("remove 幂等：存在返回 true，缺失返回 false", async () => {
    const task = await store.create({ title: "A", requirementId: "REQ-1", projectId: "p-alpha" })
    expect(await store.remove(task.id)).toBe(true)
    expect(store.get(task.id)).toBeUndefined()
    expect(await store.remove(task.id)).toBe(false)
  })

  it("持久化：重开域后数据仍在，序号延续", async () => {
    await store.create({ title: "A", requirementId: "REQ-1", projectId: "p-alpha" })
    await store.close()

    const reopened = await TaskStore.open(harness.ctx)
    try {
      const records = reopened.list()
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ id: "TASK-2800", title: "A" })
      const third = await reopened.create({ title: "C", requirementId: "REQ-1", projectId: "p-alpha" })
      expect(third.id).toBe("TASK-2801")
    } finally {
      await reopened.close()
    }
  })

  it("createBatch 成功：序号连续、全部 todo、绑定同一需求", async () => {
    const created = await store.createBatch({
      requirementId: "REQ-100",
      projectId: "p-alpha",
      tasks: [
        { title: "实现A", description: "核心逻辑" },
        { title: "B 联调" },
        { title: "  C 验收  " },
      ],
    })
    expect(created.map((t) => t.id)).toEqual(["TASK-2800", "TASK-2801", "TASK-2802"])
    expect(created.every((t) => t.status === "todo" && t.requirementId === "REQ-100")).toBe(true)
    expect(created[2].title).toBe("C 验收")
    expect(created[0].description).toBe("核心逻辑")
  })

  it("createBatch 校验失败零写入、序号不消耗", async () => {
    await expect(
      store.createBatch({
        requirementId: "REQ-100",
        projectId: "p-alpha",
        tasks: [{ title: "  " }, { title: "ok" }],
      }),
    ).rejects.toMatchObject({ code: "invalid-input" })
    expect(store.list()).toHaveLength(0)

    // 序号未被消耗：下一个 create 仍是 TASK-2800
    const next = await store.create({ title: "之后", requirementId: "REQ-100", projectId: "p-alpha" })
    expect(next.id).toBe("TASK-2800")
  })

  it("createBatch 拒绝空数组、超上限（50）与缺 requirementId/projectId", async () => {
    await expect(store.createBatch({ requirementId: "R", projectId: "p", tasks: [] })).rejects.toMatchObject({ code: "invalid-input" })
    const many = Array.from({ length: 51 }, (_, i) => ({ title: `t${i}` }))
    await expect(store.createBatch({ requirementId: "R", projectId: "p", tasks: many })).rejects.toMatchObject({ code: "invalid-input" })
    await expect(store.createBatch({ requirementId: " ", projectId: "p", tasks: [{ title: "x" }] })).rejects.toMatchObject({ code: "invalid-input" })
  })

  it("并发 createBatch 与 create 混合 id 唯一", async () => {
    const [batch, singles] = await Promise.all([
      store.createBatch({
        requirementId: "R",
        projectId: "p-alpha",
        tasks: [{ title: "A" }, { title: "B" }],
      }),
      Promise.all([
        store.create({ title: "C", requirementId: "R", projectId: "p-alpha" }),
        store.create({ title: "D", requirementId: "R", projectId: "p-alpha" }),
      ]),
    ])
    const ids = [...batch, ...singles].map((t) => t.id)
    expect(new Set(ids).size).toBe(4)
  })
})
