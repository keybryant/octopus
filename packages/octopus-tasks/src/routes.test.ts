import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import Storage from "@deepseek-ai/dsh-storage"
import * as JsonStorage from "@deepseek-ai/dsh-storage-json"
import * as DomainStorage from "@deepseek-ai/dsh-storage-domain"
import {
  createTaskApiHandler,
  MAX_BODY_SIZE,
  parseBatchInput,
  parseCreateInput,
  parseDecomposeInput,
  parsePatchInput,
  TASKS_PATH,
  type RouteHandler,
} from "./routes.js"
import { TaskStore } from "./store.js"

function createReq(method: string, url: string, body?: unknown) {
  const req: { method: string; url: string; [Symbol.asyncIterator]?: () => AsyncGenerator<Buffer> } = { method, url }
  if (body !== undefined) {
    const payload = typeof body === "string" ? body : JSON.stringify(body)
    req[Symbol.asyncIterator] = async function* () {
      yield Buffer.from(payload, "utf8")
    }
  }
  return req
}

function createRes() {
  const calls: { status: number; headers: Record<string, string>; body: string }[] = []
  return {
    calls,
    writeHead(status: number, headers: Record<string, string> = {}) {
      calls.push({ status, headers, body: "" })
    },
    end(body?: string | Uint8Array) {
      calls[calls.length - 1].body += String(body ?? "")
    },
  }
}

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "octopus-task-routes-"))
  const ctx = new Context()
  await ctx.plugin(Storage as any)
  await ctx.plugin(JsonStorage as any, { root })
  await ctx.plugin(DomainStorage as any, { backend: "json" })
  const store = await TaskStore.open(ctx)
  const handler: RouteHandler = createTaskApiHandler(store)
  return { ctx, root, store, handler }
}

describe("parse*Input", () => {
  it("parseCreateInput 归一化合法入参（status 等未知字段忽略）", () => {
    expect(parseCreateInput({ title: "A", requirementId: "R", projectId: "p", description: "d", status: "done" })).toEqual({
      title: "A",
      requirementId: "R",
      projectId: "p",
      description: "d",
    })
    expect(parseCreateInput({ title: "B", requirementId: "R", projectId: "p" })).toEqual({ title: "B", requirementId: "R", projectId: "p" })
    expect(parseCreateInput({ title: "A", requirementId: "R", projectId: "p", agent: "octopus-developer" })).toEqual({
      title: "A",
      requirementId: "R",
      projectId: "p",
      agent: "octopus-developer",
    })
    expect(() => parseCreateInput({ title: "A", projectId: "p" })).toThrowError(/requirementId is required/)
  })

  it("parseBatchInput 要求 requirementId/projectId + tasks 数组，任务字段收敛", () => {
    const parsed = parseBatchInput({
      requirementId: "R",
      projectId: "p",
      tasks: [{ title: "A", description: "d", agent: "octopus-developer", extra: 1 }, { title: "B" }],
    })
    expect(parsed.tasks).toEqual([{ title: "A", description: "d", agent: "octopus-developer" }, { title: "B" }])
    expect(() => parseBatchInput({ requirementId: "R", projectId: "p", tasks: "x" })).toThrowError(/tasks/)
    expect(() => parseBatchInput({ requirementId: "R", tasks: [{ title: "A" }] })).toThrowError(/projectId is required/)
  })

  it("parseDecomposeInput 要求 requirementId 与 title，description 可选", () => {
    expect(parseDecomposeInput({ requirementId: "R", title: "T" })).toEqual({ requirementId: "R", title: "T" })
    expect(parseDecomposeInput({ requirementId: "R", title: "T", description: "d" })).toEqual({ requirementId: "R", title: "T", description: "d" })
    expect(() => parseDecomposeInput({ requirementId: "R" })).toThrowError(/title is required/)
    expect(() => parseDecomposeInput({ title: "T" })).toThrowError(/requirementId is required/)
  })

  it("parsePatchInput 只接受声明字段并拒绝空更新", () => {
    expect(parsePatchInput({ status: "doing", title: "A2", extra: 1 })).toEqual({ status: "doing", title: "A2" })
    expect(() => parsePatchInput({ status: "bogus" })).toThrowError(/status/)
    expect(() => parsePatchInput({})).toThrowError(/no fields to update/)
  })
})

describe("task REST API", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>
  let handler: RouteHandler

  beforeEach(async () => {
    harness = await createHarness()
    handler = harness.handler
  })

  afterEach(async () => {
    await harness.store.close()
    await rm(harness.root, { recursive: true, force: true })
  })

  async function call(method: string, url: string, body?: unknown) {
    const res = createRes()
    await handler(createReq(method, url, body), res)
    return { res, body: JSON.parse(res.calls[0].body) }
  }

  it("POST 单条创建返回 201，状态固定 todo", async () => {
    const { res, body } = await call("POST", TASKS_PATH, {
      title: "导出 CSV",
      requirementId: "REQ-100",
      projectId: "p-alpha",
      description: "控制台导出",
      agent: "octopus-developer",
      status: "done",
    })
    expect(res.calls[0].status).toBe(201)
    expect(body.data).toMatchObject({
      id: "TASK-2800",
      title: "导出 CSV",
      requirementId: "REQ-100",
      projectId: "p-alpha",
      description: "控制台导出",
      agent: "octopus-developer",
      status: "todo",
    })
  })

  it("POST 非法 JSON 400 / 缺字段 400 / 超限 413", async () => {
    const bad = await call("POST", TASKS_PATH, "{not json")
    expect(bad.res.calls[0].status).toBe(400)
    expect(bad.body.error.code).toBe("invalid-json")

    const noTitle = await call("POST", TASKS_PATH, { requirementId: "R", projectId: "p" })
    expect(noTitle.res.calls[0].status).toBe(400)

    const res = createRes()
    await handler(createReq("POST", TASKS_PATH, JSON.stringify({ title: "x".repeat(MAX_BODY_SIZE + 1), requirementId: "R", projectId: "p" })), res)
    expect(res.calls[0].status).toBe(413)
  })

  it("批量创建：成功返回整批；任一校验失败响应 400 且零写入", async () => {
    const okResp = await call("POST", TASKS_PATH + "/batch", {
      requirementId: "REQ-100",
      projectId: "p-alpha",
      tasks: [{ title: "A" }, { title: "B", description: "b" }],
    })
    expect(okResp.res.calls[0].status).toBe(201)
    expect(okResp.body.data.map((t: any) => t.id)).toEqual(["TASK-2800", "TASK-2801"])

    const badResp = await call("POST", TASKS_PATH + "/batch", {
      requirementId: "REQ-100",
      projectId: "p-alpha",
      tasks: [{ title: "" }, { title: "C" }],
    })
    expect(badResp.res.calls[0].status).toBe(400)

    const list = await call("GET", TASKS_PATH + "?projectId=p-alpha")
    expect(list.body.data).toHaveLength(2)
  })

  it("decompose 返回固定 3 条草稿，契约未来不变", async () => {
    const { res, body } = await call("POST", TASKS_PATH + "/decompose", {
      requirementId: "REQ-100",
      title: "OAuth 2.0 重构",
      description: "无感登录",
    })
    expect(res.calls[0].status).toBe(200)
    expect(body.data.drafts).toEqual([
      { title: "实现OAuth 2.0 重构 · 核心逻辑", description: "无感登录" },
      { title: "OAuth 2.0 重构 · 联调与测试" },
      { title: "OAuth 2.0 重构 · 验收与上线准备" },
    ])
  })

  it("GET 列表：projectId 必填，支持 status/requirementId 过滤", async () => {
    await call("POST", TASKS_PATH, { title: "A", requirementId: "REQ-1", projectId: "p-alpha" })
    await call("POST", TASKS_PATH, { title: "B", requirementId: "REQ-2", projectId: "p-alpha" })
    await call("POST", TASKS_PATH, { title: "C", requirementId: "REQ-1", projectId: "p-beta" })

    expect((await call("GET", TASKS_PATH)).res.calls[0].status).toBe(400)

    const all = await call("GET", TASKS_PATH + "?projectId=p-alpha")
    expect(all.body.data.map((t: any) => t.id)).toEqual(["TASK-2800", "TASK-2801"])

    const byReq = await call("GET", TASKS_PATH + "?projectId=p-alpha&requirementId=REQ-1")
    expect(byReq.body.data).toHaveLength(1)
    expect(byReq.body.data[0].id).toBe("TASK-2800")

    const byStatus = await call("GET", TASKS_PATH + "?projectId=p-alpha&status=todo")
    expect(byStatus.body.data.map((t: any) => t.id)).toEqual(["TASK-2800", "TASK-2801"])

    expect((await call("GET", TASKS_PATH + "?projectId=p-alpha&status=bogus")).res.calls[0].status).toBe(400)
  })

  it("PATCH 更新与状态机：422 非法 / 404 缺失 / 400 空标题", async () => {
    await call("POST", TASKS_PATH, { title: "A", requirementId: "R", projectId: "p-alpha" })

    const moved = await call("PATCH", TASKS_PATH + "/TASK-2800", { title: "A2", status: "doing" })
    expect(moved.body.data).toMatchObject({ id: "TASK-2800", title: "A2", status: "doing" })

    const illegal = await call("PATCH", TASKS_PATH + "/TASK-2800", { status: "done" })
    expect(illegal.res.calls[0].status).toBe(422)
    expect(illegal.body.error.code).toBe("invalid-transition")

    expect((await call("PATCH", TASKS_PATH + "/TASK-9999", { title: "x" })).res.calls[0].status).toBe(404)
    expect((await call("PATCH", TASKS_PATH + "/TASK-2800", { title: "   " })).res.calls[0].status).toBe(400)
  })

  it("DELETE 幂等，GET 单条命中/404", async () => {
    await call("POST", TASKS_PATH, { title: "A", requirementId: "R", projectId: "p-alpha" })
    expect((await call("DELETE", TASKS_PATH + "/TASK-2800")).body).toEqual({ ok: true, data: true })
    expect((await call("DELETE", TASKS_PATH + "/TASK-2800")).body).toEqual({ ok: true, data: false })

    expect((await call("GET", TASKS_PATH + "/TASK-2800")).res.calls[0].status).toBe(404)
  })

  it("500 不泄露内部错误；405/404 方法路径错误", async () => {
    const broken = createTaskApiHandler({
      list: () => {
        throw new Error("secret-detail")
      },
    } as never)
    const res = createRes()
    await broken(createReq("GET", TASKS_PATH + "?projectId=p"), res)
    expect(res.calls[0].status).toBe(500)
    expect(JSON.stringify(JSON.parse(res.calls[0].body))).not.toContain("secret-detail")

    expect((await call("PUT", TASKS_PATH, { title: "A" })).res.calls[0].status).toBe(405)
    expect((await call("GET", TASKS_PATH + "/nope/extra")).res.calls[0].status).toBe(404)
  })
})
