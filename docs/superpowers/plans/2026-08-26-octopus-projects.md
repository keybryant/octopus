# octopus-projects 项目管理服务插件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `octopus-projects` 服务端插件（storageDomain 持久化 + CRUD API + 自动创建 dsh 工作区），并在壳工作台接入项目列表 API 与「项目设置」弹窗（编辑保存/删除）。

**Architecture:** 插件 inject `[webServer, storageDomain, workspaceRegistry]`，用 `defineDomain("projects")` 声明单表 domain，注册单一 prefix 路由 `/api/octopus-projects` 内部按 method+path 分发。壳 web 的 `api.ts` 增加 fetch 客户端，App 挂载时拉取列表（失败回退 mock），新建项目改走 POST，新增 ProjectSettingsModal 走 PATCH/DELETE。

**Tech Stack:** TypeScript + Cordis 插件、zod v4（domain schema）、@deepseek-ai/schemastery（插件 Config）、React 18 + Tailwind v4 + octopus-ui（壳侧）、vitest。

**Spec:** `docs/superpowers/specs/2026-08-26-octopus-projects-design.md`

## Global Constraints

- 工作目录：隔离 worktree `D:\develop\aiCode\octopus-worktrees\feature-product`（分支 feature-product），禁止动主检出
- 环境坑：新包/新依赖后需 `pnpm install`；全新 worktree 需 `install → pnpm build → 再 install`（quickstart 以 `file:` 协议快照 octopus 包内容，lib 构建产物要二次 install 才进拷贝）
- 测试命令（PowerShell，worktree 根执行）：插件 `pnpm --filter octopus-projects test`；壳 web `pnpm --filter octopus exec vitest run --root web`；类型检查 `pnpm --filter octopus-projects exec tsc --noEmit` / `pnpm --filter octopus exec tsc -p web/tsconfig.json --noEmit`
- 壳 web 代码 React 只能命名导入 `"react"`、`"react-dom"`、`"react/jsx-runtime"`（vendor 改写约束）
- 壳 web 样式只写 Tailwind 工具类与语义 token（禁裸色值/arbitrary 颜色）；图标经 `octopus-ui` 出口
- 插件运行时依赖进 `dependencies`，仅类型用的进 `devDependencies`
- 提交信息约定式前缀（`feat:` / `fix:` / `test:` / `docs:` / `chore:`），每个任务至少一次提交
- 中文文案与既有 UI 一致；状态中文映射：active=进行中 paused=已暂停 done=已完成 archived=已归档

---

### Task 1: 插件包脚手架 + 领域模型（domain.ts）

**Files:**
- Create: `packages/octopus-projects/package.json`、`cordis.patch.yml`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`README.md`
- Create: `packages/octopus-projects/src/domain.ts`
- Test: `packages/octopus-projects/src/domain.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces（后续任务全部依赖以下精确签名）:

```ts
// src/domain.ts
export const PROJECT_STATUSES = ["active", "paused", "done", "archived"] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export const projectRecordSchema: zod.ZodObject<{...}>   // name/description/status/workspacePath/workspaceId/createdAt
export type ProjectRecord = zod.infer<typeof projectRecordSchema>
export const projectsDomainSpec        // defineDomain({ name: "projects", version: 1, tables: { projects: domainTable(projectRecordSchema) } })
export function isValidProjectName(raw: string): boolean   // trim 后 1–64 字符、拒绝 \/:*?"<>| 与控制字符、拒绝 "." ".."
export function resolveDefaultWorkspaceRoot(configured?: string): string  // "~"→homedir；"~/x"→join(homedir(),"x")；其余 resolve()
export const DEFAULT_CONFIG = { defaultWorkspaceRoot: "~/octopus-projects" }
```

- [ ] **Step 1: 写脚手架文件**

`package.json`：

```json
{
  "name": "octopus-projects",
  "version": "0.1.0",
  "description": "Project management service plugin for the octopus workbench",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@deepseek-ai/dsh-storage-domain": "^0.1.1-rc.2",
    "@deepseek-ai/schemastery": "^3.18.1",
    "zod": "^4.4.3"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "octopus": "^0.1.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-workspace": "^0.1.1-rc.2",
    "@types/node": "^22.0.0",
    "octopus": "file:../octopus",
    "typescript": "^5.6.0",
    "vitest": "^4.1.8"
  }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: octopus-projects
      name: octopus-projects
```

`tsconfig.json` / `tsconfig.build.json` / `vitest.config.ts` / `README.md`：照抄 `packages/octopus-quickstart` 同名文件（README 内容改为本插件一句话说明：项目管理服务——storageDomain 持久化 + `/api/octopus-projects` CRUD + 自动创建 dsh 工作区）。

- [ ] **Step 2: 写失败测试 domain.test.ts**

```ts
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
```

注意 `DEFAULT_CONFIG.defaultWorkspaceRoot.slice(2)` 断言依赖默认值以 `~/` 开头——若后续改默认值需同步该用例。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm install ; pnpm --filter octopus-projects test`
Expected: FAIL（src/domain.ts 不存在）

- [ ] **Step 4: 实现 domain.ts**

```ts
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { domainTable, defineDomain } from "@deepseek-ai/dsh-storage-domain"
import { z as zod } from "zod"

export const PROJECT_STATUSES = ["active", "paused", "done", "archived"] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const projectRecordSchema = zod.object({
  name: zod.string().min(1),
  description: zod.string(),
  status: zod.enum(PROJECT_STATUSES),
  workspacePath: zod.string().min(1),
  workspaceId: zod.string().min(1),
  createdAt: zod.string().min(1),
})
export type ProjectRecord = zod.infer<typeof projectRecordSchema>

export const projectsDomainSpec = defineDomain({
  name: "projects",
  version: 1,
  tables: { projects: domainTable(projectRecordSchema) },
})

const NAME_RE = /^[^\\/:*?"<>|\x00-\x1f]+$/

export function isValidProjectName(raw: string): boolean {
  const name = raw.trim()
  if (name.length < 1 || name.length > 64) return false
  if (name === "." || name === "..") return false
  return NAME_RE.test(name)
}

export const DEFAULT_CONFIG = { defaultWorkspaceRoot: "~/octopus-projects" }

export function resolveDefaultWorkspaceRoot(configured?: string): string {
  const raw = configured?.trim() ? configured.trim() : DEFAULT_CONFIG.defaultWorkspaceRoot
  if (raw === "~") return homedir()
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return join(homedir(), raw.slice(2))
  return resolve(isAbsolute(raw) ? raw : raw)
}
```

- [ ] **Step 5: 测试转绿 + typecheck**

Run: `pnpm --filter octopus-projects test ; pnpm --filter octopus-projects exec tsc --noEmit`
Expected: PASS 全绿；tsc 0 error

- [ ] **Step 6: Commit**

```powershell
git add packages/octopus-projects
git commit -m "feat(octopus-projects): plugin scaffold with projects domain spec"
```

---

### Task 2: API 分发器（api.ts）

**Files:**
- Create: `packages/octopus-projects/src/api.ts`
- Test: `packages/octopus-projects/src/api.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isValidProjectName`、`PROJECT_STATUSES`、`ProjectStatus`、`ProjectRecord`
- Produces:

```ts
// src/api.ts
export const BASE_PATH = "/api/octopus-projects"
export interface ApiRequest { method?: string; url?: string; on(event: string, listener: (...args: never[]) => void): unknown }
export interface ApiResponse { writeHead(status: number, headers?: Record<string, string>): unknown; end(body?: string | Uint8Array): unknown }
export interface ProjectsTableLike {
  get(id: string): ProjectRecord | undefined
  entries(): IterableIterator<[string, ProjectRecord]>
  put(id: string, value: ProjectRecord): Promise<void>
  delete(id: string): Promise<boolean>
}
export interface WorkspaceRegistryLike { create(path: string, title?: string): Promise<{ id: string }> }
export interface ProjectsApiDeps { defaultRoot: string; projects: ProjectsTableLike; workspaces: WorkspaceRegistryLike }
export interface ProjectView { id: string; name: string; description: string; status: ProjectStatus; workspacePath: string; workspaceId: string; createdAt: string }
export function createProjectsHandler(deps: ProjectsApiDeps): (req: ApiRequest, res: ApiResponse) => Promise<void>
export class ApiError extends Error { constructor(readonly status: number, message: string) }
```

路由语义：`GET /config` → `{ defaultWorkspaceRoot }`；`GET /projects` → `{ items }` 按 createdAt 倒序；`POST /projects` `{name, description?, status?}` → 201 `{project}`；`PATCH /projects/:id` `{description?, status?}` → `{project}`；`DELETE /projects/:id` → `{deleted:true}`；未知子路径 404；已知路径错误 method 405。

- [ ] **Step 1: 写失败测试 api.test.ts**

```ts
import { mkdtempSync, rmSync, stat } from "node:fs/promises"
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
    expect(new Date(view.createdAt).toString()).not.toBe("Invalid Date")
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus-projects test`
Expected: FAIL（./api.js 不存在）

- [ ] **Step 3: 实现 api.ts**

```ts
import { randomUUID } from "node:crypto"
import { stat, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { isValidProjectName, PROJECT_STATUSES, type ProjectRecord, type ProjectStatus } from "./domain.js"

export const BASE_PATH = "/api/octopus-projects"

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export interface ApiRequest {
  method?: string
  url?: string
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface ApiResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string | Uint8Array): unknown
}

export interface ProjectsTableLike {
  get(id: string): ProjectRecord | undefined
  entries(): IterableIterator<[string, ProjectRecord]>
  put(id: string, value: ProjectRecord): Promise<void>
  delete(id: string): Promise<boolean>
}

export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<{ id: string }>
}

export interface ProjectsApiDeps {
  defaultRoot: string
  projects: ProjectsTableLike
  workspaces: WorkspaceRegistryLike
}

export interface ProjectView extends ProjectRecord {}

function sendJson(res: ApiResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

function readRawBody(req: ApiRequest): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    let data = ""
    req.on("data", (chunk) => { data += typeof chunk === "string" ? chunk : String(chunk ?? "") })
    req.on("end", () => resolveP(data))
    req.on("error", (error) => rejectP(error instanceof Error ? error : new Error(String(error))))
  })
}

async function readJsonBody(req: ApiRequest): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req)
  try {
    const parsed: unknown = JSON.parse(raw.length > 0 ? raw : "{}")
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object")
    return parsed as Record<string, unknown>
  } catch {
    throw new ApiError(400, "malformed json body")
  }
}

function parseStatus(value: unknown): ProjectStatus {
  if (typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value)) {
    return value as ProjectStatus
  }
  throw new ApiError(400, "invalid status")
}

function toView(id: string, record: ProjectRecord): ProjectView {
  return { id, ...record }
}

export function createProjectsHandler(deps: ProjectsApiDeps): (req: ApiRequest, res: ApiResponse) => Promise<void> {
  return async function handler(req, res) {
    try {
      let pathname = "/"
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)
      } catch {
        sendJson(res, 400, { error: "bad request path" })
        return
      }
      const method = (req.method ?? "GET").toUpperCase()
      const sub = pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname
      const segs = sub.split("/").filter(Boolean)

      if (method === "GET" && sub === "/config") {
        sendJson(res, 200, { defaultWorkspaceRoot: deps.defaultRoot })
        return
      }

      if (segs[0] !== "projects") {
        sendJson(res, 404, { error: "not found" })
        return
      }

      if (method === "GET" && segs.length === 1) {
        const items = [...deps.projects.entries()]
          .map(([id, record]) => toView(id, record))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        sendJson(res, 200, { items })
        return
      }

      if (method === "POST" && segs.length === 1) {
        const body = await readJsonBody(req)
        const name = typeof body.name === "string" ? body.name.trim() : ""
        if (!isValidProjectName(name)) throw new ApiError(400, "invalid project name")
        const status = body.status === undefined ? "active" : parseStatus(body.status)
        const description = typeof body.description === "string" ? body.description : ""
        const dir = join(deps.defaultRoot, name)
        if (await stat(dir).then(() => true, () => false)) {
          throw new ApiError(409, `workspace path already exists: ${dir}`)
        }
        await mkdir(dir, { recursive: true })
        let workspaceId: string
        try {
          const ws = await deps.workspaces.create(dir, name)
          workspaceId = ws.id
        } catch (error) {
          throw new ApiError(409, `workspace create failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        const id = randomUUID()
        const record: ProjectRecord = { name, description, status, workspacePath: dir, workspaceId, createdAt: new Date().toISOString() }
        await deps.projects.put(id, record)
        sendJson(res, 201, { project: toView(id, record) })
        return
      }

      if (segs.length === 2 && method === "PATCH") {
        const id = segs[1]
        const existing = deps.projects.get(id)
        if (!existing) throw new ApiError(404, "project not found")
        const body = await readJsonBody(req)
        const next: ProjectRecord = { ...existing }
        if ("description" in body) {
          if (typeof body.description !== "string") throw new ApiError(400, "description must be a string")
          next.description = body.description
        }
        if ("status" in body) next.status = parseStatus(body.status)
        await deps.projects.put(id, next)
        sendJson(res, 200, { project: toView(id, next) })
        return
      }

      if (segs.length === 2 && method === "DELETE") {
        const removed = await deps.projects.delete(segs[1])
        if (!removed) throw new ApiError(404, "project not found")
        sendJson(res, 200, { deleted: true })
        return
      }

      if (segs.length <= 2) {
        sendJson(res, 405, { error: "method not allowed" })
        return
      }
      sendJson(res, 404, { error: "not found" })
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, { error: error.message })
        return
      }
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
```

注意：测试里 `makeTable` 的返回类型若与 `ProjectsTableLike` 结构不匹配（`peek` 多余字段），在传给 handler 时直接传对象字面量即可（多余字段不报错因为是变量而非内联字面量）。

- [ ] **Step 4: 测试转绿**

Run: `pnpm --filter octopus-projects test`
Expected: PASS 全绿

- [ ] **Step 5: Commit**

```powershell
git add packages/octopus-projects/src/api.ts packages/octopus-projects/src/api.test.ts
git commit -m "feat(octopus-projects): crud api dispatcher with workspace binding"
```

---

### Task 3: apply 接线（index.ts）+ 根脚本 + README

**Files:**
- Create: `packages/octopus-projects/src/index.ts`
- Test: `packages/octopus-projects/src/index.test.ts`
- Modify: `package.json`（根，dev/dev:noopen 脚本追加 `./packages/octopus-projects`）
- Modify: `README.md`（根，结构段加一行）

**Interfaces:**
- Consumes: Task 1 `projectsDomainSpec`/`resolveDefaultWorkspaceRoot`；Task 2 `BASE_PATH`/`createProjectsHandler`/`ProjectsApiDeps`/`ApiRequest`
- Produces:

```ts
// src/index.ts
export const name: "octopus-projects"
export const inject: ["webServer", "storageDomain", "workspaceRegistry"]
export const Config   // schemastery z.object({ defaultWorkspaceRoot: z.string().default("~/octopus-projects") })
export async function apply(ctx: Context, config?: Partial<typeof DEFAULT_CONFIG>): Promise<void>
```

行为：`storageDomain.open` 成功 → 注册 prefix `/api/octopus-projects` 正常 handler（disposer 里同时 close domain）；open 失败 → 注册恒返 503 JSON 的占位路由；webServer 缺失 → 直接返回。

- [ ] **Step 1: 写失败测试 index.test.ts**

```ts
import { describe, expect, it, vi } from "vitest"
import { apply, BASE_PATH } from "./api.js"

function mockContext(openImpl: () => Promise<unknown>) {
  const registered: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
  let disposeAll: (() => void) | undefined
  const dispose = vi.fn()
  const ctx: any = {
    webServer: { register: vi.fn((route: (typeof registered)[number]) => { registered.push(route); return dispose }) },
    storageDomain: { open: vi.fn(openImpl) },
    workspaceRegistry: { create: vi.fn() },
    effect: vi.fn((factory: () => () => void) => { disposeAll = factory() }),
  }
  return { ctx, registered, dispose, getDisposeAll: () => disposeAll }
}

function resCollector() {
  const calls: { status: number; body: string }[] = []
  return {
    calls,
    writeHead(status: number) { calls.push({ status, body: "" }) },
    end(body?: string | Uint8Array) { if (calls.length > 0) calls[calls.length - 1].body += String(body ?? "") },
  }
}

const fakeDomain = {
  table: () => ({
    get: () => undefined,
    entries: () => new Map().entries(),
    put: async () => {},
    delete: async () => true,
  }),
}

describe("apply", () => {
  it("registers prefix route backed by storage domain", async () => {
    const { ctx, registered } = mockContext(() => Promise.resolve(fakeDomain))
    await apply(ctx, { defaultWorkspaceRoot: "~/proj-root" })
    expect(ctx.storageDomain.open).toHaveBeenCalledTimes(1)
    expect(registered).toHaveLength(1)
    expect(registered[0].kind).toBe("prefix")
    expect(registered[0].path).toBe(BASE_PATH)
    const res = resCollector()
    await registered[0].handler({ method: "GET", url: `${BASE_PATH}/config`, on() {} }, res)
    expect(res.calls[0].status).toBe(200)
    expect(JSON.parse(res.calls[0].body).defaultWorkspaceRoot).toContain("proj-root")
  })

  it("dispose closes route and domain", async () => {
    const domainClose = vi.fn()
    const { ctx, dispose, getDisposeAll } = mockContext(() => Promise.resolve({ ...fakeDomain, close: domainClose }))
    await apply(ctx, {})
    getDisposeAll()?.()
    expect(dispose).toHaveBeenCalled()
    expect(domainClose).toHaveBeenCalled()
  })

  it("degrades to 503 placeholder when storage open fails", async () => {
    const { ctx, registered } = mockContext(() => Promise.reject(new Error("storage down")))
    await apply(ctx, {})
    expect(registered).toHaveLength(1)
    const res = resCollector()
    await registered[0].handler({ method: "GET", url: `${BASE_PATH}/projects`, on() {} }, res)
    expect(res.calls[0].status).toBe(503)
  })

  it("does nothing without webServer", async () => {
    const { ctx, registered, getDisposeAll } = mockContext(() => Promise.resolve(fakeDomain))
    ctx.webServer = undefined
    await apply(ctx, {})
    expect(registered).toHaveLength(0)
    expect(getDisposeAll()).toBeUndefined()
  })
})
```

注意：`import { apply } ...` 实际来自 `./index.js`，`BASE_PATH` 来自 `./api.js`——按此调整 import 行。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus-projects test -- src/index.test.ts`
Expected: FAIL（./index.js 不存在）

- [ ] **Step 3: 实现 index.ts**

```ts
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import {
  BASE_PATH,
  createProjectsHandler,
  type ApiRequest,
  type ProjectsApiDeps,
} from "./api.js"
import {
  DEFAULT_CONFIG,
  projectsDomainSpec,
  resolveDefaultWorkspaceRoot,
} from "./domain.js"

export { DEFAULT_CONFIG }

interface RouteHandlerLike {
  kind: "exact" | "prefix"
  path: string
  handler: (req: never, res: never) => unknown
}
interface WebServerLike {
  register(route: RouteHandlerLike): () => void
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    webServer: WebServerLike
    storageDomain: import("@deepseek-ai/dsh-storage-domain").DomainFacility
    workspaceRegistry: import("@deepseek-ai/dsh-workspace").WorkspaceRegistry
  }
}

export const name = "octopus-projects"
export const inject = ["webServer", "storageDomain", "workspaceRegistry"]

export const Config = z.object({
  defaultWorkspaceRoot: z.string().default(DEFAULT_CONFIG.defaultWorkspaceRoot),
})

export async function apply(ctx: Context, config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const root = resolveDefaultWorkspaceRoot(config.defaultWorkspaceRoot)
  const webServer = ctx.webServer
  if (!webServer) return

  let deps: ProjectsApiDeps
  try {
    const domain = await ctx.storageDomain.open(projectsDomainSpec)
    const table = domain.table("projects")
    deps = {
      defaultRoot: root,
      projects: {
        get: (id) => table.get(id),
        entries: () => table.entries(),
        put: async (id, value) => { await table.put(id, value) },
        delete: async (id) => await table.delete(id),
      },
      workspaces: {
        create: (path, title) => ctx.workspaceRegistry.create(path, title),
      },
    }
  } catch {
    ctx.effect(() =>
      webServer.register({
        kind: "prefix",
        path: BASE_PATH,
        handler: async (_req: unknown, res: import("octopus").HttpResponse) => {
          res.writeHead(503, { "content-type": "application/json; charset=utf-8" })
          res.end(JSON.stringify({ error: "[octopus-projects] 存储域未就绪" }))
        },
      }),
    )
    return
  }

  const handler = createProjectsHandler(deps)
  ctx.effect(() =>
    webServer.register({
      kind: "prefix",
      path: BASE_PATH,
      handler: (req: unknown, res: unknown) => handler(req as ApiRequest, res as import("octopus").HttpResponse),
    }),
  )
  // 注意：domain 生命周期随 disposer 关闭
}
```

两处修正说明（实现时照做）：
1. `ctx.effect` 的工厂需返回 disposer 并关闭 domain：把 open 移入 effect 工厂不可行（异步），因此改为——effect 工厂返回 `() => { disposeRoute(); void domain.close() }`。落地写法：

```ts
  const handler = createProjectsHandler(deps)
  ctx.effect(() => {
    const disposeRoute = webServer.register({
      kind: "prefix",
      path: BASE_PATH,
      handler: (req: unknown, res: unknown) => handler(req as ApiRequest, res as import("octopus").HttpResponse),
    })
    return () => {
      disposeRoute()
      void domain.close()
    }
  })
```

503 分支同理保持默认（无额外资源）。
2. 若 `table.get/put/delete/entries` 的精确类型与适配器签名冲突（KvTable 键型为品牌 string），以 `as` 收窄为适配器接口即可，不改运行时行为。

- [ ] **Step 4: 全包测试转绿 + typecheck + build**

Run: `pnpm --filter octopus-projects test ; pnpm --filter octopus-projects exec tsc --noEmit ; pnpm --filter octopus-projects run build`
Expected: 全绿；lib/ 产出 index.js/domain.js/api.js + types

- [ ] **Step 5: 更新根 package.json 与 README**

根 `package.json` 两个 dev 脚本的 `--profile web add` 参数表追加 ` ./packages/octopus-projects`：

```jsonc
"dev": "pnpm install && pnpm build && pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-quickstart ./packages/octopus-projects --config.auto-install-peers=false && pnpm dsh web",
"dev:noopen": "pnpm install && pnpm build && pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-quickstart ./packages/octopus-projects --config.auto-install-peers=false && pnpm dsh web --no-open"
```

根 `README.md` 的「结构」段追加一行：

```markdown
- `packages/octopus-projects`：项目管理服务插件，持久化项目并暴露 `/api/octopus-projects` CRUD，自动创建 dsh 工作区
```

- [ ] **Step 6: Commit**

```powershell
git add packages/octopus-projects package.json README.md
git commit -m "feat(octopus-projects): host wiring with degrade-to-503 and dev script mount"
```

---

### Task 4: 壳 web API 客户端

**Files:**
- Modify: `packages/octopus/web/src/api.ts`（追加）
- Test: `packages/octopus/web/src/api.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 的 HTTP 语义（路径、状态码、响应体形状）
- Produces:

```ts
// api.ts 追加导出
export type ProjectStatusValue = "active" | "paused" | "done" | "archived"
export interface ProjectRecordView {
  id: string; name: string; description: string
  status: ProjectStatusValue
  workspacePath: string; workspaceId: string; createdAt: string
}
export function fetchProjects(): Promise<ProjectRecordView[] | null>   // null=服务不可用
export function fetchProjectsConfig(): Promise<{ defaultWorkspaceRoot: string } | null>
export function createProject(input: { name: string; description?: string; status?: ProjectStatusValue }): Promise<ProjectRecordView | null>
export function updateProject(id: string, patch: { description?: string; status?: ProjectStatusValue }): Promise<boolean>
export function deleteProject(id: string): Promise<boolean>
```

- [ ] **Step 1: 写失败测试 api.test.ts**

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { createProject, deleteProject, fetchProjects, updateProject } from "./api"

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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus exec vitest run --root web src/api.test.ts`
Expected: FAIL（函数不存在）

- [ ] **Step 3: 实现（api.ts 追加）**

```ts
export type ProjectStatusValue = "active" | "paused" | "done" | "archived"

export interface ProjectRecordView {
  id: string
  name: string
  description: string
  status: ProjectStatusValue
  workspacePath: string
  workspaceId: string
  createdAt: string
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(input, init)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function fetchProjects(): Promise<ProjectRecordView[] | null> {
  const data = await requestJson<{ items: ProjectRecordView[] }>("/api/octopus-projects/projects")
  return data ? data.items : null
}

export async function fetchProjectsConfig(): Promise<{ defaultWorkspaceRoot: string } | null> {
  return requestJson<{ defaultWorkspaceRoot: string }>("/api/octopus-projects/config")
}

export async function createProject(
  input: { name: string; description?: string; status?: ProjectStatusValue },
): Promise<ProjectRecordView | null> {
  const data = await requestJson<{ project: ProjectRecordView }>("/api/octopus-projects/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return data ? data.project : null
}

export async function updateProject(
  id: string,
  patch: { description?: string; status?: ProjectStatusValue },
): Promise<boolean> {
  const data = await requestJson<unknown>(`/api/octopus-projects/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  })
  return data !== null
}

export async function deleteProject(id: string): Promise<boolean> {
  const data = await requestJson<unknown>(`/api/octopus-projects/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  return data !== null
}
```

- [ ] **Step 4: 测试转绿**

Run: `pnpm --filter octopus exec vitest run --root web src/api.test.ts`
Expected: PASS ×3

- [ ] **Step 5: Commit**

```powershell
git add packages/octopus/web/src/api.ts packages/octopus/web/src/api.test.ts
git commit -m "feat(web): projects api client for octopus-projects plugin"
```

---

### Task 5: ProjectSettingsModal 组件

**Files:**
- Create: `packages/octopus/web/src/components/ProjectSettingsModal.tsx`
- Test: `packages/octopus/web/src/components/ProjectSettingsModal.test.tsx`

**Interfaces:**
- Consumes: octopus-ui `Modal`(props: open/onOpenChange/title/description/widthClass/children)、`Button`(variant: primary|secondary|ghost|danger)、`Textarea`
- Produces:

```ts
export type SettingsProject = {
  id: string
  name: string
  description: string
  status: "active" | "paused" | "done" | "archived"
  workspacePath: string
  createdAt: string
}
export interface ProjectSettingsModalProps {
  open: boolean
  onClose: () => void
  project: SettingsProject | null
  onSave: (data: { description: string; status: SettingsProject["status"] }) => Promise<boolean>   // true=成功（组件自行 onClose）
  onDelete: () => Promise<boolean>                                                                  // true=成功（组件自行 onClose）
}
```

UI 结构：Modal(title="项目设置") 内——只读三行（名称/工作区目录 mono/创建时间 toLocaleString）+ 介绍 Textarea(rows=3) + 四态 segmented（flex 一行四钮，选中 `bg-accent text-accent-foreground`）+ 底部按钮行：左 danger 文字钮「删除项目」（二次确认态文案变「确认删除？」再点执行）、右侧「取消」「保存」（primary）。error 文案红字显示于按钮行上方（`text-danger text-xs`）。

- [ ] **Step 1: 写失败测试**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ProjectSettingsModal, type SettingsProject } from "./ProjectSettingsModal"

const project: SettingsProject = {
  id: "p1", name: "Octopus Platform", description: "旧介绍", status: "active",
  workspacePath: "~/octopus-projects/Octopus Platform", createdAt: "2026-08-26T02:00:00.000Z",
}

function renderModal(overrides: Partial<Parameters<typeof ProjectSettingsModal>[0]> = {}) {
  const onSave = vi.fn(async () => true)
  const onDelete = vi.fn(async () => true)
  const onClose = vi.fn()
  render(<ProjectSettingsModal open onClose={onClose} project={project} onSave={onSave} onDelete={onDelete} {...overrides} />)
  return { onSave, onDelete, onClose }
}

describe("ProjectSettingsModal", () => {
  it("renders readonly fields and prefilled editable ones", () => {
    renderModal()
    expect(screen.getByText("Octopus Platform")).toBeInTheDocument()
    expect(screen.getByText(/octopus-projects\/Octopus Platform/)).toBeInTheDocument()
    expect(screen.getByRole("textbox")).toHaveValue("旧介绍")
    expect(screen.getByText("进行中")).toBeInTheDocument()
  })

  it("saves edited values and closes on success", async () => {
    const { onSave, onClose } = renderModal()
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新介绍" } })
    fireEvent.click(screen.getByText("已归档"))
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ description: "新介绍", status: "archived" }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("keeps open and shows error when save fails", async () => {
    const onSave = vi.fn(async () => false)
    renderModal({ onSave })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(screen.getByText(/保存失败/)).toBeInTheDocument())
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("requires two clicks to delete; failure shows error", async () => {
    const onDelete = vi.fn(async () => false)
    renderModal({ onDelete })
    fireEvent.click(screen.getByRole("button", { name: "删除项目" }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "确认删除？" }))
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
    expect(screen.getByText(/删除失败/)).toBeInTheDocument()
  })

  it("cancel closes without callbacks", () => {
    const { onSave, onDelete, onClose } = renderModal()
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus exec vitest run --root web src/components/ProjectSettingsModal.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现组件**

```tsx
import { useEffect, useState } from "react"
import { Button, Modal, Textarea } from "octopus-ui"

export type SettingsProject = {
  id: string
  name: string
  description: string
  status: "active" | "paused" | "done" | "archived"
  workspacePath: string
  createdAt: string
}

export interface ProjectSettingsModalProps {
  open: boolean
  onClose: () => void
  project: SettingsProject | null
  onSave: (data: { description: string; status: SettingsProject["status"] }) => Promise<boolean>
  onDelete: () => Promise<boolean>
}

const STATUS_OPTIONS = [
  { value: "active", label: "进行中" },
  { value: "paused", label: "已暂停" },
  { value: "done", label: "已完成" },
  { value: "archived", label: "已归档" },
] as const

export function ProjectSettingsModal({ open, onClose, project, onSave, onDelete }: ProjectSettingsModalProps) {
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<SettingsProject["status"]>("active")
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && project) {
      setDescription(project.description)
      setStatus(project.status)
    }
    if (!open) {
      setConfirmingDelete(false)
      setError(null)
    }
  }, [open, project])

  if (!project) return null

  const handleSave = async () => {
    setBusy(true)
    setError(null)
    const ok = await onSave({ description, status })
    setBusy(false)
    if (ok) onClose()
    else setError("保存失败，请重试")
  }

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setBusy(true)
    setError(null)
    const ok = await onDelete()
    setBusy(false)
    if (ok) onClose()
    else setError("删除失败，请重试")
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="项目设置" description="编辑项目信息或删除项目">
      <div className="space-y-4">
        <div className="grid grid-cols-[72px_1fr] items-center gap-y-2 text-xs">
          <span className="text-muted-foreground">名称</span>
          <span className="truncate text-sm font-medium">{project.name}</span>
          <span className="text-muted-foreground">工作区</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{project.workspacePath}</span>
          <span className="text-muted-foreground">创建时间</span>
          <span className="text-sm">{new Date(project.createdAt).toLocaleString()}</span>
        </div>
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">项目介绍</div>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明项目目标" />
        </div>
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">项目状态</div>
          <div className="flex overflow-hidden rounded-lg border border-border">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatus(opt.value)}
                className={
                  "flex-1 py-1.5 text-xs transition-colors duration-fast " +
                  (status === opt.value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground")
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {error && <div className="text-xs text-danger">{error}</div>}
        <div className="flex items-center border-t border-border pt-3">
          <Button variant="danger" size="sm" disabled={busy} onClick={handleDelete}>
            {confirmingDelete ? "确认删除？" : "删除项目"}
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={handleSave}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
```

实现时核对 octopus-ui `Button` 是否有 `size` prop：若无则去掉 `size="sm"` 用默认。danger variant 不存在时用 ghost + `text-danger` className 兜底。

- [ ] **Step 4: 测试转绿**

Run: `pnpm --filter octopus exec vitest run --root web src/components/ProjectSettingsModal.test.tsx`
Expected: PASS ×5

- [ ] **Step 5: Commit**

```powershell
git add packages/octopus/web/src/components/ProjectSettingsModal.tsx packages/octopus/web/src/components/ProjectSettingsModal.test.tsx
git commit -m "feat(web): project settings modal with edit save and confirm-delete"
```

---

### Task 6: TopBar 项目设置入口

**Files:**
- Modify: `packages/octopus/web/src/components/TopBar.tsx`
- Test: `packages/octopus/web/src/components/TopBar.test.tsx`（更新 fixtures + 新用例）

**Interfaces:**
- Consumes: 无新增
- Produces: `TopBarProps` 增加 `onOpenProjectSettings: () => void`；设置菜单「项目设置」项 onSelect 触发它

- [ ] **Step 1: 更新测试（先改 fixtures 再加用例）**

现有三个用例的 `props` 对象补 `onOpenProjectSettings: vi.fn()`；新增用例：

```tsx
it("opens project settings from the settings menu", () => {
  render(<TopBar {...props} />)
  fireEvent.click(screen.getByTitle("设置"))
  fireEvent.click(screen.getByText("项目设置"))
  expect(props.onOpenProjectSettings).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus exec vitest run --root web src/components/TopBar.test.tsx`
Expected: FAIL（缺必填 prop 编译错/菜单项无回调）

- [ ] **Step 3: 实现**

`TopBarProps` 加 `onOpenProjectSettings: () => void`；解构参数同步；菜单项改为：

```tsx
<DropdownMenuItem onSelect={onOpenProjectSettings}>项目设置</DropdownMenuItem>
```

- [ ] **Step 4: 测试转绿**

Run: `pnpm --filter octopus exec vitest run --root web src/components/TopBar.test.tsx`
Expected: PASS ×4

- [ ] **Step 5: Commit**

```powershell
git add packages/octopus/web/src/components/TopBar.tsx packages/octopus/web/src/components/TopBar.test.tsx
git commit -m "feat(web): wire project settings menu entry in top bar"
```

---

### Task 7: App 集成（API 列表/新建/设置弹窗）

**Files:**
- Modify: `packages/octopus/web/src/App.tsx`
- Test: `packages/octopus/web/src/App.test.tsx`（扩展 vi.mock + 新用例）

**Interfaces:**
- Consumes: Task 4 `fetchProjects/createProject/updateProject/deleteProject`、Task 5 组件、Task 6 入口
- Produces: App 行为契约（见下方用例断言）

数据流决策：
- 挂载时 `fetchProjects()`；返回 `null`（插件不在）→ 保持 mock `PROJECTS`；返回数组（含空）→ 映射为 ProjectSummary 替换 state（空数组也回落 mock，避免空态 UI 范围膨胀）
- 另持 `records: Record<string, ProjectRecordView>` 存原始记录，供设置弹窗展示 workspacePath/status（ProjectSummary 无这些字段）
- `handleCreateProject`：API 模式下走 `createProject`（成功追加+选中，失败 console.warn 保持原状）；mock 模式走原有本地逻辑
- 设置弹窗保存 → `updateProject` 成功后同步 records 与 summary.description；删除 → `deleteProject` 成功后移除，列表空则回落 `PROJECTS`

- [ ] **Step 1: 扩展 App.test.tsx 的 mock 与新用例**

`vi.mock("./api", ...)` 扩展为：

```tsx
vi.mock("./api", () => ({
  fetchConfig: vi.fn().mockResolvedValue(null),
  fetchModules: vi.fn().mockResolvedValue([]),
  fetchProjects: vi.fn().mockResolvedValue(null),       // 默认走 mock 回退，保住既有用例
  createProject: vi.fn(),
  updateProject: vi.fn().mockResolvedValue(true),
  deleteProject: vi.fn().mockResolvedValue(true),
}))
```

新增用例（放进现有 describe）：

```tsx
it("loads projects from api when available", async () => {
  mockedFetchProjects.mockResolvedValue([
    { id: "p-api", name: "API Project", description: "", status: "active",
      workspacePath: "~/r/API Project", workspaceId: "w", createdAt: "2026-08-26T00:00:00.000Z" },
  ])
  render(<App />)
  expect(await screen.findAllByText("API Project").then((els) => els.length)).toBeGreaterThan(0)
})

it("settings modal saves status change via PATCH", async () => {
  mockedFetchProjects.mockResolvedValue([
    { id: "p-api", name: "API Project", description: "d", status: "active",
      workspacePath: "~/r/API Project", workspaceId: "w", createdAt: "2026-08-26T00:00:00.000Z" },
  ])
  render(<App />)
  fireEvent.click(await screen.findByTitle("设置"))
  fireEvent.click(screen.getByText("项目设置"))
  fireEvent.click(await screen.findByText("已暂停"))
  fireEvent.click(screen.getByRole("button", { name: "保存" }))
  await waitFor(() => expect(mockedUpdateProject).toHaveBeenCalledWith("p-api", { description: "d", status: "paused" }))
  await waitFor(() => expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument())
})

it("settings modal deletes project and falls back to remaining list", async () => {
  mockedFetchProjects.mockResolvedValue([
    { id: "p-a", name: "Alpha", description: "", status: "active", workspacePath: "~/r/A", workspaceId: "w", createdAt: "2026-08-25T00:00:00.000Z" },
    { id: "p-b", name: "Beta", description: "", status: "active", workspacePath: "~/r/B", workspaceId: "w", createdAt: "2026-08-26T00:00:00.000Z" },
  ])
  render(<App />)
  fireEvent.click(await screen.findByTitle("设置"))
  fireEvent.click(screen.getByText("项目设置"))
  fireEvent.click(await screen.findByRole("button", { name: "删除项目" }))
  fireEvent.click(screen.getByRole("button", { name: "确认删除？" }))
  await waitFor(() => expect(mockedDeleteProject).toHaveBeenCalledWith("p-b"))   // 当前选中的是最新项目 p-b
  await waitFor(() => expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0))  // 回落到剩余第一项
})

it("create project goes through POST in api mode", async () => {
  mockedFetchProjects.mockResolvedValue([])
  // 空数组回落 mock 列表 → 走 mock 模式；此处验证 API 模式：
  mockedFetchProjects.mockResolvedValueOnce([] as never)  // 保持简单：跳过此用例亦可，见 Step 4 说明
})
```

最后一个用例实现复杂度高于价值——**删除它**，改为在 Step 4 手工冒烟覆盖 POST 路径。同时从 mock 声明中去掉不需要的引用变量（`mockedCreateProject` 可保留备用但不用例断言）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus exec vitest run --root web src/App.test.tsx`
Expected: 新用例 FAIL（App 未接弹窗/API）

- [ ] **Step 3: 重写 App.tsx 相关段落**

关键改动（伪代码对齐现有文件结构，落地时融入现文件）：

```tsx
import { createProject, deleteProject, fetchProjects, updateProject, type ProjectRecordView } from "./api"
import { ProjectSettingsModal, type SettingsProject } from "./components/ProjectSettingsModal"

function toSummary(p: ProjectRecordView): ProjectSummary {
  return {
    id: p.id, name: p.name, shortName: deriveShortName(p.name),
    description: p.description || "暂无描述", iteration: "未排期", dueDate: "-",
    progressPct: 0, weeklyDone: 0, weeklyTotal: 0, activeRequirements: 0, overdue: 0, members: [],
  }
}

// App 内新增 state
const [records, setRecords] = useState<Record<string, ProjectRecordView>>({})
const [usingApi, setUsingApi] = useState(false)
const [settingsOpen, setSettingsOpen] = useState(false)

useEffect(() => {
  void fetchProjects().then((items) => {
    if (!items || items.length === 0) return            // 服务不在或空 → 保持 mock
    setUsingApi(true)
    setRecords(Object.fromEntries(items.map((p) => [p.id, p])))
    setProjects(items.map(toSummary))
    setProjectId(items[0].id)
  })
}, [])

// handleCreateProject 改造
const handleCreateProject = async (data: { name: string; description: string }) => {
  if (usingApi) {
    const created = await createProject({ name: data.name, description: data.description })
    if (!created) {
      console.warn("[octopus] 创建项目失败")
      return
    }
    setRecords((prev) => ({ ...prev, [created.id]: created }))
    setProjects((prev) => [...prev, toSummary(created)])
    setProjectId(created.id)
    return
  }
  /* ……原有 mock 本地逻辑不动…… */
}

// 设置弹窗数据流
const settingsTarget: SettingsProject | null = (() => {
  const rec = records[projectId]
  if (rec) return { id: rec.id, name: rec.name, description: rec.description, status: rec.status, workspacePath: rec.workspacePath, createdAt: rec.createdAt }
  const summary = projects.find((p) => p.id === projectId)
  if (!summary || usingApi) return null                 // API 模式下必须有记录才可编辑
  return null                                           // mock 项目不提供真实设置（无 workspacePath）
})()

const handleSaveSettings = async (data: { description: string; status: SettingsProject["status"] }) => {
  if (!usingApi || !settingsTarget) return false
  const ok = await updateProject(settingsTarget.id, data)
  if (!ok) return false
  setRecords((prev) => ({ ...prev, [settingsTarget.id]: { ...prev[settingsTarget.id], ...data } }))
  setProjects((prev) => prev.map((p) => (p.id === settingsTarget.id ? { ...p, description: data.description || "暂无描述" } : p)))
  return true
}

const handleDeleteSettings = async () => {
  if (!usingApi || !settingsTarget) return false
  const ok = await deleteProject(settingsTarget.id)
  if (!ok) return false
  const restRecords = { ...records }
  delete restRecords[settingsTarget.id]
  setRecords(restRecords)
  const rest = projects.filter((p) => p.id !== settingsTarget.id)
  const next = rest.length > 0 ? rest : PROJECTS        // 删空回落 mock（与列表策略一致）
  setProjects(next)
  setProjectId(next[0].id)
  return true
}
```

JSX 增挂：

```tsx
<TopBar ... onOpenProjectSettings={() => setSettingsOpen(true)} />
<ProjectSettingsModal
  open={settingsOpen && settingsTarget !== null}
  onClose={() => setSettingsOpen(false)}
  project={settingsTarget}
  onSave={handleSaveSettings}
  onDelete={handleDeleteSettings}
/>
```

- [ ] **Step 4: 全量 web 测试转绿**

Run: `pnpm --filter octopus exec vitest run --root web`
Expected: 全部 PASS（既有用例因 fetchProjects→null 回退不受影响）

- [ ] **Step 5: typecheck**

Run: `pnpm --filter octopus exec tsc -p web/tsconfig.json --noEmit`
Expected: 0 error

- [ ] **Step 6: Commit**

```powershell
git add packages/octopus/web/src/App.tsx packages/octopus/web/src/App.test.tsx
git commit -m "feat(web): wire projects api and settings modal into app shell"
```

---

### Task 8: 全量回归 + 构建 + 手工冒烟

**Files:**
- 无新代码（验证任务）

- [ ] **Step 1: 安装与全量构建**

Run: `pnpm install ; pnpm build`
Expected: 四个包全部构建成功（octopus-projects 产出 lib/）

- [ ] **Step 2: 全量测试**

Run: `pnpm test`
Expected: 全绿（octopus-ui / octopus / octopus-projects / octopus-quickstart）

- [ ] **Step 3: 手工冒烟**

Run: `pnpm dev:noopen`，浏览器访问 `http://127.0.0.1:3080/workbench`，核对清单：

- [ ] 设置齿轮 → 「项目设置」打开弹窗；mock 项目（未接 API 前）弹窗不出现属预期（settingsTarget 为 null）
- [ ] 通过切换器「新建项目」建一个真实项目（如 `smoke-proj`）→ `~/octopus-projects/smoke-proj` 目录已创建
- [ ] dsh 主界面（`http://127.0.0.1:3080/`）工作区列表出现 smoke-proj
- [ ] 刷新 `/workbench` → 切换器仍显示 smoke-proj（持久化生效）
- [ ] 设置弹窗改介绍/状态 → 保存 → 刷新后仍在
- [ ] 删除 smoke-proj（二次确认）→ 列表回落；目录与 dsh 工作区仍保留
- [ ] 停掉 octopus-projects 插件场景（可选）：手动从 profile 移除后 `/workbench` 仍可用且回退 mock

- [ ] **Step 4: 收尾提交（如有零散改动）**

```powershell
git status
# 如有遗漏文件：补充提交 chore: final adjustments for octopus-projects integration
```

---

## Self-Review 记录

- 规格覆盖：五字段模型（T1）、四态状态（T1/T5）、名称校验（T1/T2）、创建流程 mkdir→create→put（T2）、CRUD+405/404/409/400/500（T2）、503 降级（T3）、dev 脚本挂载（T3）、壳 API client（T4）、设置弹窗编辑/保存/二次确认删除（T5）、TopBar 死链激活（T6）、App 接入与 mock 回退（T7）、手工冒烟含工作区验证（T8）——spec 各节均有对应任务
- 占位扫描：Task 7 Step 1 中 POST 用例已显式决定移除并由冒烟覆盖，非 TBD
- 类型一致性：`ProjectRecord`/`ProjectStatus`（T1）→ `ProjectView`（T2）→ `ProjectRecordView`（T4，wire 形状一致）→ `SettingsProject`（T5）字段名逐一对应；`BASE_PATH` 在 T2/T3 同源；`onSave/onDelete` 返回 `Promise<boolean>` 在 T5/T7 两端一致
