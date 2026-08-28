import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import Storage from "@deepseek-ai/dsh-storage"
import * as JsonStorage from "@deepseek-ai/dsh-storage-json"
import * as DomainStorage from "@deepseek-ai/dsh-storage-domain"
import plugin from "./index.js"
import type { RequirementStore } from "./store.js"

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "octopus-req-idx-"))
  const ctx = new Context()
  ctx.provide("workbench", { register: () => () => {}, list: () => [] } as never)
  ctx.provide("webServer", { register: () => () => {} } as never)
  await ctx.plugin(Storage as never)
  await ctx.plugin(JsonStorage as never, { root })
  await ctx.plugin(DomainStorage as never, { backend: "json" })
  await ctx.plugin(plugin as never)
  return { ctx, root }
}

/** cordis 4: 异步 effect 不被 ctx.plugin() await，轮询等待服务被 provide */
async function waitForRequirementStore(ctx: Context, timeoutMs = 5_000): Promise<RequirementStore> {
  const deadline = Date.now() + timeoutMs
  let store = ctx.get("requirementStore")
  while (!store && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    store = ctx.get("requirementStore")
  }
  if (!store) throw new Error(`service "requirementStore" not provided within ${timeoutMs}ms`)
  return store
}

/** cordis 4: 无 ctx.stop()；dispose 全部插件 fiber（等待 effect 清理，含 store.close()） */
async function stopHarness(ctx: Context) {
  for (const runtime of [...ctx.registry.values()]) {
    for (const fiber of [...runtime.fibers]) {
      await fiber.dispose()
    }
  }
}

describe("octopus-requirements index", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>

  beforeEach(async () => {
    harness = await createHarness()
  })

  afterEach(async () => {
    await stopHarness(harness.ctx)
    await rm(harness.root, { recursive: true, force: true })
  })

  it("provide requirementStore 服务可注入可用", async () => {
    const store = await waitForRequirementStore(harness.ctx)
    expect(store).toBeDefined()
    const record = await store.create({ title: "冒烟需求", projectId: "p-alpha" })
    expect(record.id).toBe("REQ-100")
    expect(harness.ctx.get("requirementStore")?.get(record.id)?.title).toBe("冒烟需求")
  })
})
