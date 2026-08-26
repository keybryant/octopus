import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import Storage from "@deepseek-ai/dsh-storage"
import * as JsonStorage from "@deepseek-ai/dsh-storage-json"
import * as DomainStorage from "@deepseek-ai/dsh-storage-domain"
import { RequirementStore } from "./store.js"
import { RequirementsError } from "./types.js"

/**
 * 真实链路测试：cordis App + storage hub + json 后端（临时目录）+ domain 层，
 * 与 dsh --profile web 的默认装配一致（root 不同）。
 */
async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "octopus-req-"))
  const ctx = new Context()
  // ctx.plugin() 返回 thenable：await 等待 apply（含 inject 依赖）完成
  await ctx.plugin(Storage as any)
  await ctx.plugin(JsonStorage as any, { root })
  await ctx.plugin(DomainStorage as any, { backend: "json" })
  const store = await RequirementStore.open(ctx)
  return { ctx, root, store }
}

describe("RequirementStore", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>
  let store: RequirementStore

  beforeEach(async () => {
    harness = await createHarness()
    store = harness.store
  })

  afterEach(async () => {
    await store.close()
    await rm(harness.root, { recursive: true, force: true })
  })

  it("create 生成递增 id，默认从 REQ-100 开始，backlog 初始态", async () => {
    const first = await store.create({ title: "  OAuth 2.0 重构  ", priority: "P0", source: "chat" })
    const second = await store.create({ title: "导出报表 CSV", description: "支持分页" })

    expect(first.id).toBe("REQ-100")
    expect(first.title).toBe("OAuth 2.0 重构")
    expect(first.priority).toBe("P0")
    expect(first.status).toBe("backlog")
    expect(first.source).toBe("chat")
    expect(first.owner).toBeNull()
    expect(first.description).toBe("")

    expect(second.id).toBe("REQ-101")
    expect(second.priority).toBe("P2")
    expect(second.source).toBe("manual")
    expect(second.description).toBe("支持分页")
    expect(second.createdAt).toBe(second.updatedAt)
  })

  it("create 拒绝空标题", async () => {
    await expect(store.create({ title: "   " })).rejects.toMatchObject({
      name: "RequirementsError",
      code: "invalid-input",
    })
  })

  it("并发 create 的 id 唯一（写链原子序号）", async () => {
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.create({ title: `需求 ${i}` })),
    )
    const ids = created.map((r) => r.id)
    expect(new Set(ids).size).toBe(20)
    expect(ids).toContain("REQ-100")
    expect(ids).toContain("REQ-119")
  })

  it("get/list 反映已写入记录", async () => {
    await store.create({ title: "A" })
    await store.create({ title: "B", priority: "P1" })

    expect(store.list().map((r) => r.id)).toEqual(["REQ-100", "REQ-101"])
    expect(store.get("REQ-100")?.title).toBe("A")
    expect(store.get("REQ-999")).toBeUndefined()
  })

  it("update 支持字段修改与合法状态迁移", async () => {
    const req = await store.create({ title: "A" })

    const renamed = await store.update(req.id, { title: "A2", owner: "张三" })
    expect(renamed.title).toBe("A2")
    expect(renamed.owner).toBe("张三")
    expect(renamed.updatedAt >= renamed.createdAt).toBe(true)

    const planned = await store.update(req.id, { status: "planned" })
    expect(planned.status).toBe("planned")

    const inProgress = await store.update(req.id, { status: "in-progress" })
    expect(inProgress.status).toBe("in-progress")

    const reviewed = await store.update(req.id, { status: "review" })
    expect(reviewed.status).toBe("review")

    const done = await store.update(req.id, { status: "done" })
    expect(done.status).toBe("done")
  })

  it("update 拒绝非法状态迁移", async () => {
    const req = await store.create({ title: "A" })
    await expect(store.update(req.id, { status: "done" })).rejects.toMatchObject({
      code: "invalid-transition",
    })
    // 状态未被污染
    expect(store.get(req.id)?.status).toBe("backlog")
  })

  it("update 不存在的 id 抛 not-found", async () => {
    await expect(store.update("REQ-999", { title: "x" })).rejects.toMatchObject({
      code: "not-found",
    })
  })

  it("remove 幂等：存在返回 true，缺失返回 false", async () => {
    const req = await store.create({ title: "A" })
    expect(await store.remove(req.id)).toBe(true)
    expect(store.get(req.id)).toBeUndefined()
    expect(await store.remove(req.id)).toBe(false)
  })

  it("持久化：重开域后数据仍在", async () => {
    await store.create({ title: "A", priority: "P1" })
    await store.create({ title: "B" })
    await store.close()

    const reopened = await RequirementStore.open(harness.ctx, { startSeq: 100 })
    try {
      const records = reopened.list()
      expect(records).toHaveLength(2)
      expect(records[0]).toMatchObject({ id: "REQ-100", title: "A", priority: "P1" })
      expect(records[1]).toMatchObject({ id: "REQ-101", title: "B" })
      // 序号延续：重开后新 id 不冲突
      const third = await reopened.create({ title: "C" })
      expect(third.id).toBe("REQ-102")
    } finally {
      await reopened.close()
    }
  })
})