import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import Storage from "@deepseek-ai/dsh-storage"
import * as JsonStorage from "@deepseek-ai/dsh-storage-json"
import * as DomainStorage from "@deepseek-ai/dsh-storage-domain"
import {
  createRequirementApiHandler,
  MAX_BODY_SIZE,
  parseCreateInput,
  parsePatchInput,
  REQUIREMENTS_PATH,
  type RouteHandler,
} from "./routes.js"
import { RequirementStore } from "./store.js"

/** 伪请求：可带 async 迭代 body（模拟 IncomingMessage 流） */
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

/** 伪响应：记录 writeHead/end 调用 */
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
  const root = await mkdtemp(join(tmpdir(), "octopus-req-routes-"))
  const ctx = new Context()
  await ctx.plugin(Storage as any)
  await ctx.plugin(JsonStorage as any, { root })
  await ctx.plugin(DomainStorage as any, { backend: "json" })
  const store = await RequirementStore.open(ctx)
  const handler: RouteHandler = createRequirementApiHandler(store)
  return { ctx, root, store, handler }
}

describe("parseCreateInput / parsePatchInput", () => {
  it("parseCreateInput 归一化合法入参", () => {
    expect(parseCreateInput({ title: "A", description: "d", priority: "P0", source: "chat" })).toEqual({
      title: "A",
      description: "d",
      priority: "P0",
    })
    expect(parseCreateInput({ title: "B" })).toEqual({ title: "B" })
  })

  it("parseCreateInput 拒绝缺 title 与非法枚举", () => {
    expect(() => parseCreateInput({})).toThrowError(/title is required/)
    expect(() => parseCreateInput({ title: "A", priority: "P9" })).toThrowError(/priority/)
    expect(() => parseCreateInput(null)).toThrowError(/object/)
  })

  it("parsePatchInput 只接受声明字段", () => {
    expect(parsePatchInput({ status: "planned", owner: null, extra: 1 })).toEqual({
      status: "planned",
      owner: null,
    })
    expect(() => parsePatchInput({ status: "bogus" })).toThrowError(/status/)
  })

  it("parsePatchInput 拒绝空标题和空更新", () => {
    expect(() => parsePatchInput({ title: "   " })).toThrowError(/title is required/)
    expect(() => parsePatchInput({})).toThrowError(/no fields to update/)
    expect(() => parsePatchInput([])).toThrowError(/object/)
  })
})

describe("requirement REST API", () => {
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

  it("POST 创建需求返回 201，source 由服务端固定为 manual", async () => {
    const { res, body } = await call("POST", REQUIREMENTS_PATH, {
      title: "OAuth 2.0 重构",
      description: "认证模块",
      priority: "P0",
      source: "chat",
    })
    expect(res.calls[0].status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.data).toMatchObject({
      id: "REQ-100",
      title: "OAuth 2.0 重构",
      priority: "P0",
      status: "backlog",
      source: "manual",
    })
  })

  it("POST 非法 JSON 返回 400 invalid-json", async () => {
    const { res, body } = await call("POST", REQUIREMENTS_PATH, "{not json")
    expect(res.calls[0].status).toBe(400)
    expect(body).toEqual({ ok: false, error: { code: "invalid-json", message: expect.any(String) } })
  })

  it("POST 缺 title 返回 400 invalid-input", async () => {
    const { res, body } = await call("POST", REQUIREMENTS_PATH, { priority: "P0" })
    expect(res.calls[0].status).toBe(400)
    expect(body.error.code).toBe("invalid-input")
  })

  it("POST 请求体超过大小上限返回 413", async () => {
    const res = createRes()
    await handler(createReq("POST", REQUIREMENTS_PATH, JSON.stringify({ title: "x".repeat(MAX_BODY_SIZE + 1) })), res)
    const body = JSON.parse(res.calls[0].body)
    expect(res.calls[0].status).toBe(413)
    expect(body.error.code).toBe("payload-too-large")
  })

  it("POST 请求体不可异步迭代返回 400", async () => {
    const res = createRes()
    // 无 Symbol.asyncIterator 的伪请求（模拟非 IncomingMessage 场景）
    await handler({ method: "POST", url: REQUIREMENTS_PATH } as never, res)
    const body = JSON.parse(res.calls[0].body)
    expect(res.calls[0].status).toBe(400)
    expect(body.error.code).toBe("bad-request")
  })

  it("500 响应不泄露内部错误信息", async () => {
    const broken = createRequirementApiHandler({
      list: () => {
        throw new Error("secret-detail")
      },
    } as never)
    const res = createRes()
    await broken(createReq("GET", REQUIREMENTS_PATH), res)
    const body = JSON.parse(res.calls[0].body)
    expect(res.calls[0].status).toBe(500)
    expect(body.error.code).toBe("internal")
    expect(JSON.stringify(body)).not.toContain("secret-detail")
  })

  it("GET 列表 + status/priority 过滤", async () => {
    await call("POST", REQUIREMENTS_PATH, { title: "A", priority: "P0" })
    await call("POST", REQUIREMENTS_PATH, { title: "B", priority: "P1" })
    await call("PATCH", REQUIREMENTS_PATH + "/REQ-100", { status: "planned" })

    const all = await call("GET", REQUIREMENTS_PATH)
    expect(all.body.data.map((r: any) => r.id)).toEqual(["REQ-100", "REQ-101"])

    const filtered = await call("GET", REQUIREMENTS_PATH + "?status=planned&priority=P0")
    expect(filtered.body.data).toEqual([expect.objectContaining({ id: "REQ-100" })])

    const bad = await call("GET", REQUIREMENTS_PATH + "?status=bogus")
    expect(bad.res.calls[0].status).toBe(400)
  })

  it("GET 单条：命中 200，缺失 404", async () => {
    await call("POST", REQUIREMENTS_PATH, { title: "A" })
    const hit = await call("GET", REQUIREMENTS_PATH + "/REQ-100")
    expect(hit.body.data).toMatchObject({ id: "REQ-100", title: "A" })

    const miss = await call("GET", REQUIREMENTS_PATH + "/REQ-999")
    expect(miss.res.calls[0].status).toBe(404)
    expect(miss.body.error.code).toBe("not-found")
  })

  it("PATCH 更新字段与合法迁移；非法迁移 422", async () => {
    await call("POST", REQUIREMENTS_PATH, { title: "A" })

    const patched = await call("PATCH", REQUIREMENTS_PATH + "/REQ-100", {
      title: "A2",
      status: "planned",
      owner: "张三",
    })
    expect(patched.body.data).toMatchObject({ id: "REQ-100", title: "A2", status: "planned", owner: "张三" })

    const bad = await call("PATCH", REQUIREMENTS_PATH + "/REQ-100", { status: "done" })
    expect(bad.res.calls[0].status).toBe(422)
    expect(bad.body.error.code).toBe("invalid-transition")

    const missing = await call("PATCH", REQUIREMENTS_PATH + "/REQ-999", { title: "x" })
    expect(missing.res.calls[0].status).toBe(404)
  })

  it("PATCH 拒绝空标题与空更新", async () => {
    await call("POST", REQUIREMENTS_PATH, { title: "A" })

    const emptyTitle = await call("PATCH", REQUIREMENTS_PATH + "/REQ-100", { title: "   " })
    expect(emptyTitle.res.calls[0].status).toBe(400)
    expect(emptyTitle.body.error.code).toBe("invalid-input")

    const emptyPatch = await call("PATCH", REQUIREMENTS_PATH + "/REQ-100", {})
    expect(emptyPatch.res.calls[0].status).toBe(400)
    expect(emptyPatch.body.error.code).toBe("invalid-input")
  })

  it("PATCH 拒绝回退迁移", async () => {
    await call("POST", REQUIREMENTS_PATH, { title: "A" })
    await call("PATCH", REQUIREMENTS_PATH + "/REQ-100", { status: "planned" })

    const backward = await call("PATCH", REQUIREMENTS_PATH + "/REQ-100", { status: "backlog" })
    expect(backward.res.calls[0].status).toBe(422)
    expect(backward.body.error.code).toBe("invalid-transition")
  })

  it("DELETE 幂等：200 true / 200 false", async () => {
    await call("POST", REQUIREMENTS_PATH, { title: "A" })
    const first = await call("DELETE", REQUIREMENTS_PATH + "/REQ-100")
    expect(first.body).toEqual({ ok: true, data: true })
    const second = await call("DELETE", REQUIREMENTS_PATH + "/REQ-100")
    expect(second.body).toEqual({ ok: true, data: false })
  })

  it("不支持的 method 返回 405，未知路径返回 404", async () => {
    const wrongMethod = await call("PUT", REQUIREMENTS_PATH, { title: "A" })
    expect(wrongMethod.res.calls[0].status).toBe(405)

    const unknown = await call("GET", REQUIREMENTS_PATH + "/nope/extra")
    expect(unknown.res.calls[0].status).toBe(404)
  })
})
