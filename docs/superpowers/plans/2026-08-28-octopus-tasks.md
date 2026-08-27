# octopus-tasks 插件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `packages/octopus-tasks` 独立插件：任务只从需求拆解（AI 草稿 mock + 人工确认），4 列看板 + 拖拽迁卡，替换壳内 mock 任务看板；agent 执行不在本次范围。

**Architecture:** 完全仿照 `packages/octopus-requirements` 的既有模式：`defineDomain` 存储域（`octopus_tasks`，zod schema）+ `ctx.webServer` REST 路由 + Vite library bundle 前端模块（`octopusVendor()` 共享 react/octopus-ui）。拆解链路：需求插件行内按钮 → `window` CustomEvent（事件名常量由 octopus-ui 导出）→ 壳监听并打开任务抽屉 + 写入 `window.__octopusDecomposePayload` → tasks 模块挂载时消费载荷自动弹 AI 拆解弹窗 → `POST /tasks/decompose`（mock 生成器，契约可换真 LLM）→ `POST /tasks/batch`（全有或全无）。

**Tech Stack:** Node.js + cordis 插件容器、dsh-storage-domain（JSON 落盘）、zod ^4、Vite 6 + React 18 + Tailwind 4、vitest 4 + testing-library。

**Spec:** `docs/superpowers/specs/2026-08-28-octopus-tasks-design.md`

## Global Constraints

- 域名 `octopus_tasks`，version 1；表 `tasks`（zod schema）+ `meta`（`{seq: number}`，写链原子自增）
- id 前缀 `TASK-`，默认起始序号 2800（`meta.seq` 初始 2799，首个 id `TASK-2800`）
- 状态 `"todo" | "doing" | "review" | "done"`；单向迁移 `todo→doing→review→done`，done 终态；非法迁移 422 `invalid-transition`
- 优先级 `"P0" | "P1" | "P2"`；新建状态服务端固定 `todo`（客户端不可指定）
- API 响应 `{ ok: true, data }` / `{ ok: false, error: { code, message } }`；body 上限 256KiB（413 `payload-too-large`）
- 项目隔离：`GET /tasks` 与创建必须带 `projectId`（校验必填，空则 400 `invalid-input`）
- 路由前缀 `/api/octopus-tasks`；静态资源 `/octopus/tasks/assets`；模块注册 `id: "tasks"`、`order: 30`、`entry: "/octopus/tasks/assets/index.js"`
- 不使用 dnd 依赖：拖拽用原生 HTML5 DnD（`draggable` + `dragstart/dragover/drop`）
- 事件名常量 `OCTOPUS_DECOMPOSE_EVENT = "octopus:decompose-request"` 从 octopus-ui 导出（模块间契约层）；载荷全局变量 `window.__octopusDecomposePayload`（读后清空）
- TS：strict、target ES2022、module NodeNext（host）；web 目录 Bundle 打包（moduleResolution Bundler）
- 测试命令：包内 `pnpm test`（= `vitest run && vitest run --root web`）；全仓 `pnpm test`
- commit 风格参照仓库：`feat(octopus-tasks): ...` / `docs(octopus): ...`

---

## 文件结构

```
packages/octopus-tasks/
├── package.json / cordis.patch.yml / tsconfig.json / tsconfig.build.json / vitest.config.ts
├── README.md
├── src/
│   ├── index.ts        # 插件入口：模块注册 + API 路由 + assets 托管 + effect 清理
│   ├── types.ts        # TaskRecord/TaskStatus/TaskPatch + 状态机
│   ├── unit.ts         # defineDomain octopus_tasks
│   ├── store.ts        # TaskStore（CRUD + createBatch + 序号）
│   ├── decompose.ts    # generateTaskDrafts（mock AI 拆解，契约固定）
│   ├── routes.ts       # REST 处理器
│   └── *.test.ts
└── web/
    ├── vite.config.ts / tsconfig.json / vitest.config.ts
    └── src/
        ├── index.tsx   # 模块入口：读载荷 → 看板 + 拆解弹窗
        ├── types.ts / api.ts / status.ts / index.css
        ├── components/TaskBoard.tsx
        ├── components/DecomposeDraftsModal.tsx
        └── test/setup.ts + *.test.ts(x)
```

---

## Task 1: 包骨架（host 侧）

**Files:**
- Create: `packages/octopus-tasks/package.json`
- Create: `packages/octopus-tasks/cordis.patch.yml`
- Create: `packages/octopus-tasks/tsconfig.json`
- Create: `packages/octopus-tasks/tsconfig.build.json`
- Create: `packages/octopus-tasks/vitest.config.ts`
- Create: `packages/octopus-tasks/src/index.ts`
- Create: `packages/octopus-tasks/src/index.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 插件入口三件套 `name`、`inject`、`apply`（后续 Task 6 填充 apply 内部）

- [ ] **Step 1: 创建 package.json（拷贝 requirements 模板，去掉多余 devDeps）**

```json
{
  "name": "octopus-tasks",
  "version": "0.1.0",
  "description": "Task management plugin for the octopus workbench",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib",
    "web/dist",
    "cordis.patch.yml",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && vite build web --config web/vite.config.ts && tsc -p web/tsconfig.json",
    "test": "vitest run && vitest run --root web"
  },
  "dependencies": {
    "@deepseek-ai/dsh-storage": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-storage-domain": "^0.1.1-rc.2",
    "zod": "^4.4.3"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "octopus": "^0.1.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-storage-json": "^0.1.1-rc.2",
    "@types/node": "^22.0.0",
    "@types/react": "~18.3.1",
    "@types/react-dom": "~18.3.0",
    "@vitejs/plugin-react": "^4.0.0",
    "octopus": "file:../octopus",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^4.1.8",
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.0",
    "jsdom": "^26.0.0",
    "octopus-ui": "workspace:*",
    "tailwindcss": "^4.0.0"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

- [ ] **Step 2: 创建 cordis.patch.yml**

```yaml
- insert:
    - id: octopus-tasks
      name: octopus-tasks
```

- [ ] **Step 3: 创建三个 tsconfig 与 vitest 配置**

`tsconfig.json`（与 requirements 完全一致）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`tsconfig.build.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationDir": "lib/types",
    "outDir": "lib",
    "rootDir": "src"
  },
  "exclude": ["src/**/*.test.ts"]
}
```

`vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
})
```

- [ ] **Step 4: 创建最小插件入口 + 冒烟测试**

`src/index.ts`：

```ts
import type { Context } from "@deepseek-ai/cordis"

export const name = "octopus-tasks"
export const inject = ["workbench", "webServer", "storageDomain"]

/** 功能插件：任务看板（模块注册 + REST API + 前端 bundle 托管），apply 在后续任务补全 */
export function apply(_ctx: Context) {}

export default { name, inject, apply }
```

`src/index.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import plugin, { inject, name } from "./index.js"

describe("octopus-tasks plugin", () => {
  it("导出插件元信息", () => {
    expect(name).toBe("octopus-tasks")
    expect(inject).toEqual(["workbench", "webServer", "storageDomain"])
    expect(plugin.name).toBe("octopus-tasks")
  })
})
```

- [ ] **Step 5: pnpm install 关联新 workspace 包并验证**

Run: `pnpm install`
Expected: 成功且 `packages/octopus-tasks/node_modules/@deepseek-ai` 生成。

- [ ] **Step 6: 运行测试与构建**

Run: `pnpm --filter octopus-tasks test`
Expected: `octopus-tasks plugin 导出插件元信息` PASS。

Run: `pnpm --filter octopus-tasks build`（此时 `web/` 尚不存在会失败——先只验证 tsc 部分）

Expected: `vite build` 报 "web/vite.config.ts not found"。确认这一步失败点是 web 缺失即可，构建整体验证放在 Task 7（web 骨架）之后。

- [ ] **Step 7: Commit**

```bash
git add packages/octopus-tasks
git commit -m "feat(octopus-tasks): scaffold plugin package"
```

---

## Task 2: types.ts + unit.ts（类型与状态机、存储域描述）

**Files:**
- Create: `packages/octopus-tasks/src/types.ts`
- Create: `packages/octopus-tasks/src/unit.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `TaskStatus`/`TASK_STATUSES`/`Priority`/`PRIORITIES`/`TaskRecord`/`TaskDraft`/`TaskInput`/`TaskPatch`/`TasksError`/`TasksErrorCode`/`TASK_TRANSITIONS`/`canTransition`/`assertTransition`
  - `TASKS_DOMAIN`/`TasksDomain`

- [ ] **Step 1: 写 types.ts（迁移表与 requirements 同构）**

```ts
export type TaskStatus = "todo" | "doing" | "review" | "done"

export type Priority = "P0" | "P1" | "P2"

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "review", "done"]

export const PRIORITIES: readonly Priority[] = ["P0", "P1", "P2"]

export interface TaskRecord {
  id: string
  title: string
  description: string
  requirementId: string
  projectId: string
  priority: Priority
  status: TaskStatus
  assignee: string | null
  createdAt: string
  updatedAt: string
}

/** AI 拆解草稿（decompose 返回 / batch 入参的任务内容，不含主键） */
export interface TaskDraft {
  title: string
  description?: string
  priority?: Priority
  assignee?: string
}

/** 单条创建入参（requirementId/projectId 必填） */
export interface TaskInput extends TaskDraft {
  requirementId: string
  projectId: string
}

export type TaskPatch = Partial<
  Pick<TaskRecord, "title" | "description" | "priority" | "status" | "assignee">
>

export type TasksErrorCode = "not-found" | "invalid-input" | "invalid-transition"

export class TasksError extends Error {
  constructor(
    readonly code: TasksErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "TasksError"
  }
}

/** 合法状态迁移表：单向推进，done 为终态，不可回退 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["doing"],
  doing: ["review"],
  review: ["done"],
  done: [],
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new TasksError(
      "invalid-transition",
      `invalid status transition: ${from} -> ${to}`,
    )
  }
}
```

- [ ] **Step 2: 写 unit.ts**

```ts
import { z } from "zod"
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain"

const taskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  requirementId: z.string(),
  projectId: z.string().min(1),
  priority: z.enum(["P0", "P1", "P2"]),
  status: z.enum(["todo", "doing", "review", "done"]),
  assignee: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const metaSchema = z.object({
  seq: z.number().int().nonnegative(),
})

export const TASKS_DOMAIN = defineDomain({
  name: "octopus_tasks",
  version: 1,
  tables: {
    tasks: domainTable(taskSchema),
    meta: domainTable(metaSchema),
  },
})

export type TasksDomain = typeof TASKS_DOMAIN
```

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter octopus-tasks exec tsc -p tsconfig.json`
Expected: 无输出，exit 0。

- [ ] **Step 4: Commit**

```bash
git add packages/octopus-tasks/src/types.ts packages/octopus-tasks/src/unit.ts
git commit -m "feat(octopus-tasks): task domain types and storage spec"
```

---

## Task 3: TaskStore（CRUD + 状态机 + 序号）

**Files:**
- Create: `packages/octopus-tasks/src/store.test.ts`
- Create: `packages/octopus-tasks/src/store.ts`

**Interfaces:**
- Consumes: `TASKS_DOMAIN`（unit.ts）、`TasksError`、`assertTransition`、`TaskInput`、`TaskPatch`、`TaskRecord`
- Produces: `TaskStore`（`static open(ctx, {startSeq?})`、`list(filter?)`、`get(id)`、`create(input)`、`update(id, patch)`、`remove(id)`、`close()`）；默认 `startSeq = 2800`

- [ ] **Step 1: 写失败测试 store.test.ts（镜像 requirements store.test.ts 的 harness）**

```ts
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
      priority: "P0",
      assignee: "LW",
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
    expect(first.priority).toBe("P0")
    expect(first.assignee).toBe("LW")
    expect(first.status).toBe("todo")
    expect(first.description).toBe("")

    expect(second.id).toBe("TASK-2801")
    expect(second.priority).toBe("P2")
    expect(second.assignee).toBeNull()
    expect(second.description).toBe("limit 后索引失效")
    expect(second.createdAt).toBe(second.updatedAt)
  })

  it("create 拒绝空标题 / 空 requirementId / 空 projectId", async () => {
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

    const renamed = await store.update(task.id, { title: "A2", assignee: "ZS" })
    expect(renamed.title).toBe("A2")
    expect(renamed.assignee).toBe("ZS")

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
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus-tasks test`
Expected: FAIL（`Cannot find module './store.js'`）。

- [ ] **Step 3: 实现 store.ts**

```ts
import type { Context } from "@deepseek-ai/cordis"
import type { Domain } from "@deepseek-ai/dsh-storage-domain"
import { TASKS_DOMAIN, type TasksDomain } from "./unit.js"
import {
  assertTransition,
  TasksError,
  type TaskInput,
  type TaskPatch,
  type TaskRecord,
} from "./types.js"

const TASK_TABLE = "tasks"
const META_TABLE = "meta"
const SEQ_KEY = "seq"

export interface TaskStoreOptions {
  /** id 起始序号（默认 2800，与历史 mock 看板 TASK-28xx 样式对齐） */
  startSeq?: number
}

export class TaskStore {
  private constructor(private readonly domain: Domain<TasksDomain>) {}

  static async open(ctx: Context, options: TaskStoreOptions = {}): Promise<TaskStore> {
    const domain = await ctx.storageDomain.open(TASKS_DOMAIN)
    const store = new TaskStore(domain)
    await store.ensureSeq(options.startSeq ?? 2800)
    return store
  }

  private async ensureSeq(startSeq: number): Promise<void> {
    const meta = this.domain.table(META_TABLE)
    if (meta.get(SEQ_KEY) === undefined) {
      await meta.put(SEQ_KEY, { seq: startSeq - 1 })
    }
  }

  list(filter?: (record: TaskRecord) => boolean): TaskRecord[] {
    return [...this.domain.table(TASK_TABLE).entries()]
      .map(([, record]) => record)
      .filter((record) => filter?.(record) ?? true)
      .sort((a, b) => {
        const na = Number(a.id.slice(5))
        const nb = Number(b.id.slice(5))
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
        return a.id.localeCompare(b.id)
      })
  }

  get(id: string): TaskRecord | undefined {
    return this.domain.table(TASK_TABLE).get(id)
  }

  async create(input: TaskInput): Promise<TaskRecord> {
    this.assertTaskInput(input)
    const meta = this.domain.table(META_TABLE)
    const next = await meta.update(SEQ_KEY, (m) => ({ seq: m.seq + 1 }))
    const record = this.buildRecord(`TASK-${next.seq}`, input)
    await this.domain.table(TASK_TABLE).put(record.id, record)
    return record
  }

  /** 校验入参（供 create 与 createBatch 共用；id 序号分配前调用，保证失败零写入） */
  private assertTaskInput(input: TaskInput): void {
    if (!input.title.trim()) throw new TasksError("invalid-input", "title is required")
    if (!input.requirementId.trim()) throw new TasksError("invalid-input", "requirementId is required")
    if (!input.projectId.trim()) throw new TasksError("invalid-input", "projectId is required")
  }

  private buildRecord(id: string, input: TaskInput): TaskRecord {
    const now = new Date().toISOString()
    return {
      id,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      requirementId: input.requirementId.trim(),
      projectId: input.projectId.trim(),
      priority: input.priority ?? "P2",
      status: "todo",
      assignee: input.assignee?.trim() || null,
      createdAt: now,
      updatedAt: now,
    }
  }

  async update(id: string, patch: TaskPatch): Promise<TaskRecord> {
    if (!this.domain.table(TASK_TABLE).get(id)) {
      throw new TasksError("not-found", `task ${id} not found`)
    }
    if (Object.keys(patch).length === 0) {
      throw new TasksError("invalid-input", "no fields to update")
    }
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new TasksError("invalid-input", "title is required")
    }
    const table = this.domain.table(TASK_TABLE)
    return table.update(id, (current) => {
      if (patch.status !== undefined && patch.status !== current.status) {
        assertTransition(current.status, patch.status)
      }
      const next: TaskRecord = { ...current, ...patch, updatedAt: new Date().toISOString() }
      if (patch.title !== undefined) next.title = patch.title.trim()
      if (patch.assignee !== undefined) next.assignee = patch.assignee?.trim() || null
      return next
    })
  }

  async remove(id: string): Promise<boolean> {
    return this.domain.table(TASK_TABLE).delete(id)
  }

  async close(): Promise<void> {
    await this.domain.close()
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus-tasks test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/octopus-tasks/src/store.ts packages/octopus-tasks/src/store.test.ts
git commit -m "feat(octopus-tasks): task store with status machine and id sequence"
```

---

## Task 4: createBatch（全有或全无）+ decompose mock 生成器

**Files:**
- Create: `packages/octopus-tasks/src/decompose.ts`
- Modify: `packages/octopus-tasks/src/store.ts`
- Create: `packages/octopus-tasks/src/decompose.test.ts`
- Modify: `packages/octopus-tasks/src/store.test.ts`

**Interfaces:**
- Consumes: `TaskDraft`、`TaskInput`、`TasksError`
- Produces:
  - `TaskStore.createBatch(input: { requirementId: string; projectId: string; tasks: TaskDraft[] }): Promise<TaskRecord[]>`
  - `generateTaskDrafts(input: { title: string; description?: string; priority?: Priority }): TaskDraft[]`

- [ ] **Step 1: 写 decompose.test.ts（先失败）**

```ts
import { describe, expect, it } from "vitest"
import { generateTaskDrafts } from "./decompose.js"

describe("generateTaskDrafts（mock AI 拆解）", () => {
  it("默认生成三步草稿：实现 / 联调测试 / 验收上线", () => {
    const drafts = generateTaskDrafts({ title: "OAuth 2.0 重构" })
    expect(drafts.map((d) => d.title)).toEqual([
      "实现OAuth 2.0 重构 · 核心逻辑",
      "OAuth 2.0 重构 · 联调与测试",
      "OAuth 2.0 重构 · 验收与上线准备",
    ])
    expect(drafts[0].priority).toBe("P1")
    expect(drafts[0].description).toBe("")
    expect(drafts[2].priority).toBe("P2")
  })

  it("P0 需求前置排期草稿，并携带描述", () => {
    const drafts = generateTaskDrafts({ title: "认证重构", priority: "P0", description: "无感登录" })
    expect(drafts).toHaveLength(4)
    expect(drafts[0].title).toBe("排期与拆解 认证重构")
    expect(drafts[0].priority).toBe("P0")
    expect(drafts[1].title).toBe("实现认证重构 · 核心逻辑")
    expect(drafts[1].description).toBe("无感登录")
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus-tasks test -- --root .`
Expected: FAIL（`Cannot find module './decompose.js'`）。

- [ ] **Step 3: 实现 decompose.ts**

```ts
import type { Priority, TaskDraft } from "./types.js"

export interface DecomposeContext {
  title: string
  description?: string
  priority?: Priority
}

/**
 * mock AI 拆解草稿生成器：确定性规则，标题基于需求标题模板化。
 * 真实 LLM 接入时仅替换本函数实现（契约：输入需求上下文，输出 TaskDraft[]）。
 */
export function generateTaskDrafts(input: DecomposeContext): TaskDraft[] {
  const title = input.title.trim()
  const priority = input.priority ?? "P1"
  const description = input.description?.trim() ?? ""
  const drafts: TaskDraft[] = [
    {
      title: `实现${title} · 核心逻辑`,
      priority,
      description,
    },
    {
      title: `${title} · 联调与测试`,
      priority,
    },
    {
      title: `${title} · 验收与上线准备`,
      priority: "P2",
    },
  ]
  if (priority === "P0") {
    drafts.unshift({ title: `排期与拆解 ${title}`, priority: "P0" })
  }
  return drafts
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus-tasks test`
Expected: decompose 测试 PASS。

- [ ] **Step 5: 追加 createBatch 失败测试（store.test.ts 文件末尾 describe 块内）**

```ts
  it("createBatch 成功：序号连续、全部 todo、绑定同一需求", async () => {
    const created = await store.createBatch({
      requirementId: "REQ-100",
      projectId: "p-alpha",
      tasks: [
        { title: "实现A", priority: "P0" },
        { title: "B 联调", assignee: "ZS" },
        { title: "  C 验收  " },
      ],
    })
    expect(created.map((t) => t.id)).toEqual(["TASK-2800", "TASK-2801", "TASK-2802"])
    expect(created.every((t) => t.status === "todo" && t.requirementId === "REQ-100")).toBe(true)
    expect(created[2].title).toBe("C 验收")
    expect(created[1].assignee).toBe("ZS")
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
```

- [ ] **Step 6: 运行确认失败**

Run: `pnpm --filter octopus-tasks test`
Expected: FAIL（`store.createBatch is not a function`）。

- [ ] **Step 7: 在 store.ts 实现 createBatch**

在 `TaskStore` 类的 `create` 方法之后追加（文件顶部导入同时补上 `type TaskDraft`，并追加 `export const BATCH_MAX = 50`）：

```ts
async createBatch(input: {
  requirementId: string
  projectId: string
  tasks: TaskDraft[]
}): Promise<TaskRecord[]> {
  const { requirementId, projectId, tasks } = input
  if (!requirementId.trim()) throw new TasksError("invalid-input", "requirementId is required")
  if (!projectId.trim()) throw new TasksError("invalid-input", "projectId is required")
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new TasksError("invalid-input", "tasks must be a non-empty array")
  }
  if (tasks.length > BATCH_MAX) {
    throw new TasksError("invalid-input", `at most ${BATCH_MAX} tasks per batch`)
  }
  for (const draft of tasks) {
    this.assertTaskInput({ ...draft, requirementId, projectId })
  }

  const meta = this.domain.table(META_TABLE)
  const next = await meta.update(SEQ_KEY, (m) => ({ seq: m.seq + tasks.length }))
  const table = this.domain.table(TASK_TABLE)
  const created: TaskRecord[] = []
  try {
    for (const draft of tasks) {
      const record = this.buildRecord(
        `TASK-${next.seq - tasks.length + 1 + created.length}`,
        { ...draft, requirementId, projectId },
      )
      await table.put(record.id, record)
      created.push(record)
    }
    return created
  } catch (error) {
    // 全有或全无：写入失败尽力回滚已写入记录后重抛
    await Promise.allSettled(created.map((record) => table.delete(record.id)))
    throw error
  }
}
```

- [ ] **Step 8: 运行测试确认通过**

Run: `pnpm --filter octopus-tasks test`
Expected: 全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add packages/octopus-tasks/src/decompose.ts packages/octopus-tasks/src/decompose.test.ts packages/octopus-tasks/src/store.ts packages/octopus-tasks/src/store.test.ts
git commit -m "feat(octopus-tasks): batch create with all-or-nothing and mock decompose generator"
```

---

## Task 5: REST 路由（routes.ts）

**Files:**
- Create: `packages/octopus-tasks/src/routes.test.ts`
- Create: `packages/octopus-tasks/src/routes.ts`

**Interfaces:**
- Consumes: `TaskStore`（含 `createBatch`）、`generateTaskDrafts`、`TasksError`
- Produces:
  - `API_PREFIX = "/api/octopus-tasks"`、`TASKS_PATH = "/api/octopus-tasks/tasks"`
  - `RouteHandler`、`readJsonBody`、`parseCreateInput`、`parseBatchInput`、`parseDecomposeInput`、`parsePatchInput`、`createTaskApiHandler(store)`
  - 端点：`GET /tasks?projectId=&requirementId=&status=&priority=`、`POST /tasks`（201）、`POST /tasks/batch`、`POST /tasks/decompose`、`GET /tasks/:id`、`PATCH /tasks/:id`、`DELETE /tasks/:id`

- [ ] **Step 1: 写 routes.test.ts（镜像 requirements routes.test.ts 的 harness 与伪请求器）**

```ts
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
  it("parseCreateInput 归一化合法入参并拒绝非法枚举", () => {
    expect(parseCreateInput({ title: "A", requirementId: "R", projectId: "p", priority: "P0", assignee: "ZS", status: "done" })).toEqual({
      title: "A",
      requirementId: "R",
      projectId: "p",
      priority: "P0",
      assignee: "ZS",
    })
    expect(parseCreateInput({ title: "B", requirementId: "R", projectId: "p" })).toEqual({ title: "B", requirementId: "R", projectId: "p" })
    expect(() => parseCreateInput({ title: "A", requirementId: "R", projectId: "p", priority: "P9" })).toThrowError(/priority/)
    expect(() => parseCreateInput({ title: "A", projectId: "p" })).toThrowError(/requirementId is required/)
  })

  it("parseBatchInput 要求 requirementId/projectId + tasks 数组，任务字段收敛", () => {
    const parsed = parseBatchInput({
      requirementId: "R",
      projectId: "p",
      tasks: [{ title: "A", priority: "P1", extra: 1 }, { title: "B" }],
    })
    expect(parsed.tasks).toEqual([{ title: "A", priority: "P1" }, { title: "B" }])
    expect(() => parseBatchInput({ requirementId: "R", projectId: "p", tasks: "x" })).toThrowError(/tasks/)
    expect(() => parseBatchInput({ requirementId: "R", tasks: [{ title: "A" }] })).toThrowError(/projectId is required/)
  })

  it("parseDecomposeInput 要求 requirementId 与 title", () => {
    expect(parseDecomposeInput({ requirementId: "R", title: "T" })).toEqual({ requirementId: "R", title: "T" })
    expect(() => parseDecomposeInput({ requirementId: "R" })).toThrowError(/title is required/)
    expect(() => parseDecomposeInput({ title: "T" })).toThrowError(/requirementId is required/)
  })

  it("parsePatchInput 只接受声明字段并拒绝空更新", () => {
    expect(parsePatchInput({ status: "doing", assignee: " ", extra: 1 })).toEqual({ status: "doing", assignee: null })
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
      priority: "P0",
      assignee: "LW",
      status: "done",
    })
    expect(res.calls[0].status).toBe(201)
    expect(body.data).toMatchObject({
      id: "TASK-2800",
      title: "导出 CSV",
      requirementId: "REQ-100",
      projectId: "p-alpha",
      priority: "P0",
      status: "todo",
      assignee: "LW",
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
      tasks: [{ title: "A" }, { title: "B", priority: "P0" }],
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

  it("decompose 返回草稿数组，契约未来不变", async () => {
    const { res, body } = await call("POST", TASKS_PATH + "/decompose", {
      requirementId: "REQ-100",
      title: "OAuth 2.0 重构",
      priority: "P0",
      description: "无感登录",
    })
    expect(res.calls[0].status).toBe(200)
    expect(body.data.drafts).toEqual([
      { title: "排期与拆解 OAuth 2.0 重构", priority: "P0" },
      { title: "实现OAuth 2.0 重构 · 核心逻辑", priority: "P0", description: "无感登录" },
      { title: "OAuth 2.0 重构 · 联调与测试", priority: "P0" },
      { title: "OAuth 2.0 重构 · 验收与上线准备", priority: "P2" },
    ])
  })

  it("GET 列表：projectId 必填，支持 status/requirementId/priority 过滤", async () => {
    await call("POST", TASKS_PATH, { title: "A", requirementId: "REQ-1", projectId: "p-alpha", priority: "P0" })
    await call("POST", TASKS_PATH, { title: "B", requirementId: "REQ-2", projectId: "p-alpha", priority: "P1" })
    await call("POST", TASKS_PATH, { title: "C", requirementId: "REQ-1", projectId: "p-beta" })

    expect((await call("GET", TASKS_PATH)).res.calls[0].status).toBe(400)

    const all = await call("GET", TASKS_PATH + "?projectId=p-alpha")
    expect(all.body.data.map((t: any) => t.id)).toEqual(["TASK-2800", "TASK-2801"])

    const byReq = await call("GET", TASKS_PATH + "?projectId=p-alpha&requirementId=REQ-1")
    expect(byReq.body.data).toHaveLength(1)
    expect(byReq.body.data[0].id).toBe("TASK-2800")

    const filtered = await call("GET", TASKS_PATH + "?projectId=p-alpha&status=todo&priority=P0")
    expect(filtered.body.data.map((t: any) => t.id)).toEqual(["TASK-2800"])

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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus-tasks test`
Expected: FAIL（`Cannot find module './routes.js'`）。

- [ ] **Step 3: 实现 routes.ts**

```ts
import type { HttpRequest, HttpResponse } from "octopus"
import { generateTaskDrafts } from "./decompose.js"
import { TaskStore } from "./store.js"
import {
  PRIORITIES,
  TASK_STATUSES,
  TasksError,
  type Priority,
  type TaskDraft,
  type TaskInput,
  type TaskPatch,
  type TaskStatus,
} from "./types.js"

export const API_PREFIX = "/api/octopus-tasks"
export const TASKS_PATH = API_PREFIX + "/tasks"

export type RouteHandler = (req: HttpRequest, res: HttpResponse) => Promise<void>

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export const MAX_BODY_SIZE = 256 * 1024

export async function readJsonBody(req: HttpRequest): Promise<unknown> {
  const source = req as unknown as AsyncIterable<Buffer | string>
  if (typeof source[Symbol.asyncIterator] !== "function") {
    throw new ApiError(400, "bad-request", "request body is not a readable stream")
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BODY_SIZE) {
      throw new ApiError(413, "payload-too-large", `request body exceeds ${MAX_BODY_SIZE} bytes`)
    }
    chunks.push(buf)
  }
  if (chunks.length === 0) return undefined
  const raw = Buffer.concat(chunks).toString("utf8")
  try {
    return JSON.parse(raw)
  } catch {
    throw new ApiError(400, "invalid-json", "request body is not valid JSON")
  }
}

function json(res: HttpResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

function ok(res: HttpResponse, data: unknown): void {
  json(res, 200, { ok: true, data })
}

function fail(res: HttpResponse, status: number, code: string, message: string): void {
  json(res, status, { ok: false, error: { code, message } })
}

function pathnameOf(req: HttpRequest): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname
  } catch {
    throw new ApiError(400, "bad-request", "malformed request url")
  }
}

function parseId(pathname: string): string | null {
  const match = pathname.match(new RegExp("^" + TASKS_PATH.replaceAll("/", "\/") + "\/([^/]+)$"))
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    throw new ApiError(400, "bad-request", "malformed task id")
  }
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value)
}

function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value)
}

function requireObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "invalid-input", "request body must be a JSON object")
  }
  return body as Record<string, unknown>
}

function requireString(raw: Record<string, unknown>, key: string, label: string): string {
  if (typeof raw[key] !== "string" || !(raw[key] as string).trim()) {
    throw new ApiError(400, "invalid-input", `${label} is required`)
  }
  return raw[key] as string
}

function parseDraft(raw: Record<string, unknown>, required: boolean): TaskDraft {
  const hasTitle = typeof raw.title === "string" && (raw.title as string).trim().length > 0
  if (!hasTitle) {
    if (required) throw new ApiError(400, "invalid-input", "title is required")
    return { title: "" }
  }
  const draft: TaskDraft = { title: raw.title as string }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new ApiError(400, "invalid-input", "description must be a string")
    draft.description = raw.description
  }
  if (raw.priority !== undefined) {
    if (!isPriority(raw.priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    draft.priority = raw.priority
  }
  if (raw.assignee !== undefined) {
    if (raw.assignee !== null && typeof raw.assignee !== "string") {
      throw new ApiError(400, "invalid-input", "assignee must be a string or null")
    }
    draft.assignee = (raw.assignee as string | null) ?? ""
  }
  return draft
}

export function parseCreateInput(body: unknown): TaskInput {
  const raw = requireObject(body)
  const title = requireString(raw, "title", "title")
  const requirementId = requireString(raw, "requirementId", "requirementId")
  const projectId = requireString(raw, "projectId", "projectId")
  const input: TaskInput = { title, requirementId, projectId }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new ApiError(400, "invalid-input", "description must be a string")
    input.description = raw.description
  }
  if (raw.priority !== undefined) {
    if (!isPriority(raw.priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    input.priority = raw.priority
  }
  if (raw.assignee !== undefined) {
    if (raw.assignee !== null && typeof raw.assignee !== "string") {
      throw new ApiError(400, "invalid-input", "assignee must be a string or null")
    }
    input.assignee = (raw.assignee as string | null) ?? undefined
  }
  // status 为服务端保留（新建固定 todo），客户端不可指定
  return input
}

export function parseBatchInput(body: unknown): {
  requirementId: string
  projectId: string
  tasks: TaskDraft[]
} {
  const raw = requireObject(body)
  const requirementId = requireString(raw, "requirementId", "requirementId")
  const projectId = requireString(raw, "projectId", "projectId")
  if (!Array.isArray(raw.tasks)) {
    throw new ApiError(400, "invalid-input", "tasks is required")
  }
  if (raw.tasks.length === 0) {
    throw new ApiError(400, "invalid-input", "tasks must be a non-empty array")
  }
  const tasks = raw.tasks.map((task) => parseDraft(requireObject(task), true))
  return { requirementId, projectId, tasks }
}

export function parseDecomposeInput(body: unknown): {
  requirementId: string
  title: string
  description?: string
  priority?: Priority
} {
  const raw = requireObject(body)
  const requirementId = requireString(raw, "requirementId", "requirementId")
  const title = requireString(raw, "title", "title")
  const out: { requirementId: string; title: string; description?: string; priority?: Priority } = {
    requirementId,
    title,
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new ApiError(400, "invalid-input", "description must be a string")
    out.description = raw.description
  }
  if (raw.priority !== undefined) {
    if (!isPriority(raw.priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    out.priority = raw.priority
  }
  return out
}

export function parsePatchInput(body: unknown): TaskPatch {
  const raw = requireObject(body)
  const patch: TaskPatch = {}
  if (raw.title !== undefined) {
    if (typeof raw.title !== "string" || !raw.title.trim()) {
      throw new ApiError(400, "invalid-input", "title is required")
    }
    patch.title = raw.title
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new ApiError(400, "invalid-input", "description must be a string")
    patch.description = raw.description
  }
  if (raw.priority !== undefined) {
    if (!isPriority(raw.priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    patch.priority = raw.priority
  }
  if (raw.status !== undefined) {
    if (!isStatus(raw.status)) throw new ApiError(400, "invalid-input", `status must be one of ${TASK_STATUSES.join(", ")}`)
    patch.status = raw.status
  }
  if (raw.assignee !== undefined) {
    if (raw.assignee !== null && typeof raw.assignee !== "string") {
      throw new ApiError(400, "invalid-input", "assignee must be a string or null")
    }
    patch.assignee = raw.assignee as string | null
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, "invalid-input", "no fields to update")
  }
  return patch
}

function listQuery(req: HttpRequest): {
  projectId: string
  requirementId?: string
  status?: TaskStatus
  priority?: Priority
} {
  const url = new URL(req.url ?? "/", "http://localhost")
  const projectId = url.searchParams.get("projectId")
  if (projectId === null || !projectId.trim()) {
    throw new ApiError(400, "invalid-input", "projectId is required")
  }
  const query: { projectId: string; requirementId?: string; status?: TaskStatus; priority?: Priority } = {
    projectId,
  }
  const requirementId = url.searchParams.get("requirementId")
  if (requirementId !== null) query.requirementId = requirementId
  const status = url.searchParams.get("status")
  if (status !== null) {
    if (!isStatus(status)) throw new ApiError(400, "invalid-input", `status must be one of ${TASK_STATUSES.join(", ")}`)
    query.status = status
  }
  const priority = url.searchParams.get("priority")
  if (priority !== null) {
    if (!isPriority(priority)) throw new ApiError(400, "invalid-input", `priority must be one of ${PRIORITIES.join(", ")}`)
    query.priority = priority
  }
  return query
}

export function createTaskApiHandler(store: TaskStore): RouteHandler {
  return async function handler(req: HttpRequest, res: HttpResponse) {
    try {
      await dispatch(store, req, res)
    } catch (error) {
      if (error instanceof ApiError) {
        fail(res, error.status, error.code, error.message)
      } else if (error instanceof TasksError) {
        const status = error.code === "not-found" ? 404 : error.code === "invalid-transition" ? 422 : 400
        fail(res, status, error.code, error.message)
      } else {
        console.error("[octopus-tasks] internal error", error)
        fail(res, 500, "internal", "internal server error")
      }
    }
  }
}

async function dispatch(store: TaskStore, req: HttpRequest, res: HttpResponse): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase()
  const pathname = pathnameOf(req)

  if (pathname === TASKS_PATH + "/batch") {
    if (method !== "POST") {
      fail(res, 405, "method-not-allowed", `method ${method} not allowed on ${TASKS_PATH}/batch`)
      return
    }
    const input = parseBatchInput(await readJsonBody(req))
    const records = await store.createBatch(input)
    json(res, 201, { ok: true, data: records })
    return
  }

  if (pathname === TASKS_PATH + "/decompose") {
    if (method !== "POST") {
      fail(res, 405, "method-not-allowed", `method ${method} not allowed on ${TASKS_PATH}/decompose`)
      return
    }
    const input = parseDecomposeInput(await readJsonBody(req))
    ok(res, { drafts: generateTaskDrafts(input) })
    return
  }

  if (pathname === TASKS_PATH) {
    if (method === "GET") {
      const { projectId, requirementId, status, priority } = listQuery(req)
      ok(
        res,
        store.list(
          (t) =>
            t.projectId === projectId &&
            (requirementId === undefined || t.requirementId === requirementId) &&
            (status === undefined || t.status === status) &&
            (priority === undefined || t.priority === priority),
        ),
      )
      return
    }
    if (method === "POST") {
      const input = parseCreateInput(await readJsonBody(req))
      const record = await store.create(input)
      json(res, 201, { ok: true, data: record })
      return
    }
    fail(res, 405, "method-not-allowed", `method ${method} not allowed on ${TASKS_PATH}`)
    return
  }

  const id = parseId(pathname)
  if (id !== null) {
    if (method === "GET") {
      const record = store.get(id)
      if (!record) throw new TasksError("not-found", `task ${id} not found`)
      ok(res, record)
      return
    }
    if (method === "PATCH") {
      const patch = parsePatchInput(await readJsonBody(req))
      const record = await store.update(id, patch)
      ok(res, record)
      return
    }
    if (method === "DELETE") {
      const removed = await store.remove(id)
      ok(res, removed)
      return
    }
    fail(res, 405, "method-not-allowed", `method ${method} not allowed on task ${id}`)
    return
  }

  fail(res, 404, "not-found", `no route for ${method} ${pathname}`)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus-tasks test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/octopus-tasks/src/routes.ts packages/octopus-tasks/src/routes.test.ts
git commit -m "feat(octopus-tasks): task REST api with batch and decompose endpoints"
```

---

## Task 6: 插件入口接线 + 根挂载脚本

**Files:**
- Modify: `packages/octopus-tasks/src/index.ts`
- Modify: `package.json`（根，dev 脚本追加包路径）

**Interfaces:**
- Consumes: `TaskStore`、`createTaskApiHandler`
- Produces: 完整插件入口（模块 `tasks` 注册、路由前缀、静态资源、effect 清理）

- [ ] **Step 1: 用完整实现替换 index.ts**

```ts
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "@deepseek-ai/cordis"
import { serveStaticFiles } from "octopus"
import { createTaskApiHandler } from "./routes.js"
import { TaskStore } from "./store.js"

export const name = "octopus-tasks"
export const inject = ["workbench", "webServer", "storageDomain"]

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(HERE, "..", "web", "dist")

/** 功能插件：任务看板（模块注册 + REST API + 前端 bundle 托管） */
export function apply(ctx: Context) {
  ctx.effect(async () => {
    const store = await TaskStore.open(ctx)

    const disposers: (() => void)[] = [
      ctx.workbench.register({
        id: "tasks",
        title: "任务看板",
        order: 30,
        entry: "/octopus/tasks/assets/index.js",
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/api/octopus-tasks",
        handler: createTaskApiHandler(store),
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/octopus/tasks/assets",
        handler: serveStaticFiles(DIST_DIR, "/octopus/tasks/assets"),
      }),
    ]
    return async () => {
      for (const dispose of disposers) dispose()
      await store.close().catch((error) => {
        console.error("[octopus-tasks] failed to close store", error)
      })
    }
  })
}

export default { name, inject, apply }
```

- [ ] **Step 2: 更新根 package.json 挂载脚本（dev 与 dev:noopen 均追加）**

在 `"pnpm dsh plugin --profile web add ./packages/octopus ... ./packages/octopus-projects ./packages/octopus-requirements` 末尾追加 ` ./packages/octopus-tasks`

```json
"dev": "pnpm install && pnpm build && pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-users ./packages/octopus-auth ./packages/octopus-users-view ./packages/octopus-quickstart ./packages/octopus-projects ./packages/octopus-requirements ./packages/octopus-tasks --config.auto-install-peers=false && pnpm dsh web",
"dev:noopen": "pnpm install && pnpm build && pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-users ./packages/octopus-auth ./packages/octopus-users-view ./packages/octopus-quickstart ./packages/octopus-projects ./packages/octopus-requirements ./packages/octopus-tasks --config.auto-install-peers=false && pnpm dsh web --no-open"
```

- [ ] **Step 3: 验证**

Run: `pnpm --filter octopus-tasks exec tsc -p tsconfig.json`
Expected: 无输出（`serveStaticFiles` 类型与 octopus 包一致）。

- [ ] **Step 4: Commit**

```bash
git add packages/octopus-tasks/src/index.ts package.json
git commit -m "feat(octopus-tasks): wire plugin entry and mount in dev scripts"
```

---

## Task 7: web 骨架（vite/tsconfig/vitest/CSS/最小模块）

**Files:**
- Create: `packages/octopus-tasks/web/vite.config.ts`
- Create: `packages/octopus-tasks/web/tsconfig.json`
- Create: `packages/octopus-tasks/web/vitest.config.ts`
- Create: `packages/octopus-tasks/web/src/index.css`
- Create: `packages/octopus-tasks/web/src/test/setup.ts`
- Create: `packages/octopus-tasks/web/src/index.tsx`
- Create: `packages/octopus-tasks/web/src/index.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `web/dist/index.js` 可构建产物；模块 default export 组件（Task 9 扩展）

- [ ] **Step 1: 拷贝 requirements 的 web 配置文件并改名**

`web/vite.config.ts`（仅插件名 `octopus-tasks-inline-css` 不同，其余与 requirements 逐字一致）：

```ts
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { octopusVendor } from "octopus/vite"

/** lib mode 下把 CSS 内联进 entry JS：壳只 import entry，不加载独立 css 文件 */
function inlineCss(): Plugin {
  return {
    name: "octopus-tasks-inline-css",
    apply: "build",
    generateBundle(_options, bundle) {
      const entries = Object.values(bundle)
      const cssFile = entries.find(
        (item) => item.type === "asset" && item.fileName.endsWith(".css"),
      ) as { type: "asset"; fileName: string; source: string | Uint8Array } | undefined
      const jsChunk = entries.find(
        (item) => item.type === "chunk" && item.fileName.endsWith(".js"),
      ) as { type: "chunk"; fileName: string; code: string } | undefined
      if (!cssFile || !jsChunk) return
      const css =
        typeof cssFile.source === "string"
          ? cssFile.source
          : new TextDecoder().decode(cssFile.source)
      const inject = `(()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})();`
      jsChunk.code = inject + "\n" + jsChunk.code
      delete bundle[cssFile.fileName]
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), octopusVendor(), inlineCss()],
  build: {
    outDir: "../web/dist",
    emptyOutDir: true,
    lib: {
      entry: "src/index.tsx",
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
      },
    },
  },
})
```

`web/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`web/vitest.config.ts`：

```ts
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
})
```

`web/src/index.css`：

```css
@import "tailwindcss";
@import "octopus-ui/tokens.css";
@source "../../../octopus-ui/src";
```

`web/src/test/setup.ts`：

```ts
import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => cleanup())
```

- [ ] **Step 2: 写最小模块入口与冒烟测试**

`web/src/index.tsx`：

```tsx
/** workbench 模块：任务看板（骨架占位，完整实现在后续任务接入） */
export default function TasksModule() {
  return <section className="p-4">任务看板</section>
}
```

`web/src/index.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import TasksModule from "./index"

describe("TasksModule（骨架）", () => {
  it("渲染模块标题", () => {
    render(<TasksModule />)
    expect(screen.getByText("任务看板")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: 构建与测试**

Run: `pnpm --filter octopus-tasks build`
Expected: 成功，`packages/octopus-tasks/web/dist/index.js` 生成。

Run: `pnpm --filter octopus-tasks test`
Expected: host + web（1 条 `TasksModule（骨架）`）全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/octopus-tasks/web
git commit -m "feat(octopus-tasks): web module skeleton with build pipeline"
```

---

## Task 8: web types + api + 单测

**Files:**
- Create: `packages/octopus-tasks/web/src/types.ts`
- Create: `packages/octopus-tasks/web/src/status.ts`
- Create: `packages/octopus-tasks/web/src/api.ts`
- Create: `packages/octopus-tasks/web/src/api.test.ts`

**Interfaces:**
- Consumes: 无（与后端契约对齐）
- Produces:
  - `TaskStatus`/`TaskRecord`/`TaskDraft`/`TaskPatch`/`Priority`（web 类型，与 host types.ts 对称）
  - `TASK_COLUMNS`（看板列配置）、`STATUS_META`（badge 元数据，`BadgeTone` 来自 octopus-ui）
  - `listTasks(params?)`/`createTask(input)`/`createTaskBatch(input)`/`decomposeTasks(input)`/`updateTask(id, patch)`/`removeTask(id)`/`currentProjectId()`

- [ ] **Step 1: 写 types.ts 与 status.ts**

`web/src/types.ts`：

```ts
export type TaskStatus = "todo" | "doing" | "review" | "done"

export type Priority = "P0" | "P1" | "P2"

export interface TaskRecord {
  id: string
  title: string
  description: string
  requirementId: string
  projectId: string
  priority: Priority
  status: TaskStatus
  assignee: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskDraft {
  title: string
  description?: string
  priority?: Priority
  assignee?: string
}

export type TaskPatch = Partial<
  Pick<TaskRecord, "title" | "description" | "priority" | "status" | "assignee">
>
```

`web/src/status.ts`（与后端迁移表一致）：

```ts
import type { BadgeTone } from "octopus-ui"
import type { TaskStatus } from "./types"

export interface ColumnSpec {
  key: TaskStatus
  label: string
  dotColor: string
}

/** 看板列配置（顺序即展示顺序） */
export const TASK_COLUMNS: ColumnSpec[] = [
  { key: "todo", label: "待处理", dotColor: "#5C6577" },
  { key: "doing", label: "进行中", dotColor: "#60A5FA" },
  { key: "review", label: "评审中", dotColor: "#A78BFA" },
  { key: "done", label: "已完成", dotColor: "#34D399" },
]

export const STATUS_META: Record<TaskStatus, { label: string; tone: BadgeTone }> = {
  todo: { label: "待处理", tone: "neutral" },
  doing: { label: "进行中", tone: "info" },
  review: { label: "评审中", tone: "warn" },
  done: { label: "已完成", tone: "success" },
}
```

- [ ] **Step 2: 写 api.ts（镜像 requirements web api.ts）**

```ts
import type { Priority, TaskDraft, TaskPatch, TaskRecord, TaskStatus } from "./types"

const BASE = "/api/octopus-tasks/tasks"

interface ApiOk<T> {
  ok: true
  data: T
}

/** 当前项目编码：宿主 shell 通过 window.__octopusProjectId 注入；低优先级回退 URL query */
export function currentProjectId(): string {
  const injected = (window as { __octopusProjectId?: string }).__octopusProjectId
  if (injected) return injected
  return new URLSearchParams(window.location.search).get("projectId") ?? ""
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { "content-type": "application/json" },
      ...init,
    })
  } catch {
    throw new Error("无法连接服务，请确认 octopus-tasks 插件已加载")
  }
  const body = (await res.json().catch(() => null)) as ApiOk<T> | { ok: false; error: { code: string; message: string } } | null
  if (!res.ok || !body || body.ok !== true) {
    const message = body && body.ok === false ? body.error.message : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body.data
}

export async function listTasks(params?: {
  projectId?: string
  status?: TaskStatus
  requirementId?: string
  priority?: Priority
}): Promise<TaskRecord[]> {
  const qs = new URLSearchParams()
  const projectId = params?.projectId ?? currentProjectId()
  if (projectId) qs.set("projectId", projectId)
  if (params?.status) qs.set("status", params.status)
  if (params?.requirementId) qs.set("requirementId", params.requirementId)
  if (params?.priority) qs.set("priority", params.priority)
  const query = qs.size > 0 ? `?${qs.toString()}` : ""
  return request<TaskRecord[]>(BASE + query)
}

export async function createTask(input: {
  title: string
  requirementId: string
  projectId?: string
  description?: string
  priority?: Priority
  assignee?: string
}): Promise<TaskRecord> {
  return request<TaskRecord>(BASE, {
    method: "POST",
    body: JSON.stringify({ ...input, projectId: input.projectId ?? currentProjectId() }),
  })
}

export async function createTaskBatch(input: {
  requirementId: string
  projectId?: string
  tasks: TaskDraft[]
}): Promise<TaskRecord[]> {
  return request<TaskRecord[]>(BASE + "/batch", {
    method: "POST",
    body: JSON.stringify({ requirementId: input.requirementId, projectId: input.projectId ?? currentProjectId(), tasks: input.tasks }),
  })
}

export async function decomposeTasks(input: {
  requirementId: string
  title: string
  description?: string
  priority?: Priority
}): Promise<TaskDraft[]> {
  const data = await request<{ drafts: TaskDraft[] }>(BASE + "/decompose", {
    method: "POST",
    body: JSON.stringify(input),
  })
  return data.drafts
}

export async function updateTask(id: string, patch: TaskPatch): Promise<TaskRecord> {
  return request<TaskRecord>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function removeTask(id: string): Promise<boolean> {
  return request<boolean>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" })
}
```

- [ ] **Step 3: 写 api.test.ts**

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus-tasks test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/octopus-tasks/web/src/types.ts packages/octopus-tasks/web/src/status.ts packages/octopus-tasks/web/src/api.ts packages/octopus-tasks/web/src/api.test.ts
git commit -m "feat(octopus-tasks): web api client and board column config"
```

---

## Task 9: TaskBoard + 模块组装（看板 + 拖拽迁卡）

**Files:**
- Create: `packages/octopus-tasks/web/src/components/TaskBoard.tsx`
- Modify: `packages/octopus-tasks/web/src/index.tsx`
- Modify: `packages/octopus-tasks/web/src/index.test.tsx`

**Interfaces:**
- Consumes: `listTasks`/`updateTask`/`currentProjectId`（api.ts）、`TASK_COLUMNS`/`STATUS_META`（status.ts）、`TaskRecord`、`TaskStatus`
- Produces: `TaskBoard`（props: `tasks`、`busyIds`、`onMove(id, status)`、`onOpenDecompose`? 无——本次只做看板）；模块 default export 加载三态（loading/error/board）与乐观拖拽

- [ ] **Step 1: 写 TaskBoard.tsx（原生 HTML5 DnD）**

```tsx
import { useState } from "react"
import { Badge, Spinner } from "octopus-ui"
import { TASK_COLUMNS, type ColumnSpec } from "../status"
import type { TaskRecord, TaskStatus } from "../types"

const priorityTone: Record<TaskRecord["priority"], "warn" | "info" | "neutral"> = {
  P0: "warn",
  P1: "info",
  P2: "neutral",
}

export interface TaskBoardProps {
  tasks: TaskRecord[]
  busyIds: ReadonlySet<string>
  onMove: (id: string, status: TaskStatus) => Promise<void> | void
}

function ColumnBody({ column, tasks, busyIds, onMove, dragOver, setDragOver }: {
  column: ColumnSpec
  tasks: TaskRecord[]
  busyIds: ReadonlySet<string>
  onMove: (id: string, status: TaskStatus) => Promise<void> | void
  dragOver: TaskStatus | null
  setDragOver: (s: TaskStatus | null) => void
}) {
  const isOver = dragOver === column.key
  return (
    <div
      className="w-60 shrink-0"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(column.key)
      }}
      onDragLeave={() => setDragOver((s) => (s === column.key ? null : s))}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(null)
        const id = e.dataTransfer.getData("text/plain")
        if (id) void onMove(id, column.key)
      }}
      role="group"
      aria-label={column.label}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: column.dotColor }} />
        <span className="text-xs font-medium text-muted-foreground">{column.label}</span>
        <span className="font-mono text-[11px] text-text-faint">{tasks.length}</span>
      </div>
      <div
        className={`space-y-2.5 rounded-xl p-1 transition-colors ${
          isOver ? "bg-surface-hover ring-1 ring-inset ring-border-strong" : ""
        }`}
      >
        {tasks.map((t) => (
          <div
            key={t.id}
            draggable={!busyIds.has(t.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", t.id)
              e.dataTransfer.effectAllowed = "move"
            }}
            className={`cursor-grab rounded-xl border border-border bg-surface p-3.5 transition-opacity active:cursor-grabbing ${
              t.status === "done" ? "opacity-75" : ""
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[10.5px] text-text-faint">{t.id}</span>
              <Badge tone={priorityTone[t.priority]}>{t.priority}</Badge>
              {busyIds.has(t.id) && <Spinner className="ml-auto h-3 w-3" />}
            </div>
            <div className={`text-[13px] font-medium leading-snug ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
              {t.title}
            </div>
            {t.assignee && (
              <div className="mt-2.5 flex items-center justify-end">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[9px] text-muted-foreground">
                  {t.assignee.slice(0, 2)}
                </span>
              </div>
            )}
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-[11px] text-text-faint">
            暂无任务
          </div>
        )}
      </div>
    </div>
  )
}

/** 任务看板：4 列 + 原生 HTML5 拖拽（跨列迁态，列内按创建序） */
export function TaskBoard({ tasks, busyIds, onMove }: TaskBoardProps) {
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null)

  return (
    <div className="flex min-w-max gap-4">
      {TASK_COLUMNS.map((column) => (
        <ColumnBody
          key={column.key}
          column={column}
          tasks={tasks.filter((t) => t.status === column.key)}
          busyIds={busyIds}
          onMove={onMove}
          dragOver={dragOver}
          setDragOver={setDragOver}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 用完整模块替换 web/src/index.tsx（载荷消费留到 Task 10，先只做看板三态 + 乐观拖拽）**

```tsx
import { useCallback, useEffect, useState } from "react"
import { Button, Spinner } from "octopus-ui"
import { listTasks, updateTask } from "./api"
import { TaskBoard } from "./components/TaskBoard"
import type { TaskRecord, TaskStatus } from "./types"
import "./index.css"

/** workbench 模块：任务看板 */
export default function TasksModule() {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTasks(await listTasks())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 拖拽迁卡：乐观更新，失败回滚并提示 */
  const handleMove = useCallback(
    async (id: string, status: TaskStatus) => {
      setError(null)
      setBusyIds((prev) => new Set(prev).add(id))
      const prev = tasks
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)))
      try {
        const updated = await updateTask(id, { status })
        setTasks((ts) => ts.map((t) => (t.id === id ? updated : t)))
      } catch (e) {
        setTasks(prev)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyIds((s) => {
          const next = new Set(s)
          next.delete(id)
          return next
        })
      }
    },
    [tasks],
  )

  return (
    <section className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-base font-semibold">任务看板</h2>
        <span className="text-xs text-text-faint">共 {tasks.length} 个</span>
        <span className="text-[11px] text-text-faint">从需求列表行内「拆解任务」入口拆分新任务</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-6 text-center text-sm text-danger">
          {error}
          <div className="mt-2">
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              重试
            </Button>
          </div>
        </div>
      ) : (
        <TaskBoard tasks={tasks} busyIds={busyIds} onMove={handleMove} />
      )}
    </section>
  )
}
```

- [ ] **Step 3: 重写 index.test.tsx（看板渲染 + 拖拽乐观更新 + 失败回滚）**

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import TasksModule from "./index"

const TASKS = [
  { id: "TASK-2800", title: "导出 CSV", description: "", requirementId: "REQ-100", projectId: "p-alpha", priority: "P0", status: "todo", assignee: "LW", createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
  { id: "TASK-2801", title: "联调测试", description: "", requirementId: "REQ-100", projectId: "p-alpha", priority: "P2", status: "doing", assignee: null, createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
  { id: "TASK-2802", title: "验收上线", description: "", requirementId: "REQ-100", projectId: "p-alpha", priority: "P2", status: "done", assignee: null, createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
]

function mockResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

afterEach(() => {
  delete (window as unknown as { __octopusProjectId?: string }).__octopusProjectId
  vi.unstubAllGlobals()
})

describe("TasksModule", () => {
  it("渲染四列看板与任务卡（id/优先级/负责人）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { ok: true, data: TASKS })))
    render(<TasksModule />)
    expect(await screen.findByText("导出 CSV")).toBeInTheDocument()
    for (const label of ["待处理", "进行中", "评审中", "已完成"]) {
      expect(screen.getByRole("group", { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText("TASK-2800")).toBeInTheDocument()
    expect(screen.getByText("LW")).toBeInTheDocument()
    expect(screen.getByText("共 3 个")).toBeInTheDocument()
  })

  it("拖拽迁卡：drop → PATCH status，乐观更新列归属", async () => {
    vi.stubGlobal("location", { ...window.location, search: "" })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: TASKS }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: { ...TASKS[0], status: "doing" } }))
    vi.stubGlobal("fetch", fetchMock)
    render(<TasksModule />)
    await screen.findByText("导出 CSV")

    const todoCol = screen.getByRole("group", { name: "待处理" })
    const doingCol = screen.getByRole("group", { name: "进行中" })
    expect(within(todoCol).getByText("导出 CSV")).toBeInTheDocument()

    const card = screen.getByText("导出 CSV").closest("[draggable=true]")!
    const dataTransfer = { setData: vi.fn((_k: string, id: string) => (dataTransfer.value = id)), getData: () => dataTransfer.value as string, effectAllowed: "" }
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.dragOver(doingCol, { dataTransfer })
    fireEvent.drop(doingCol, { dataTransfer })

    await waitFor(() => expect(within(doingCol).getByText("导出 CSV")).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/octopus-tasks/tasks/TASK-2800",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "doing" }) }),
    )
  })

  it("拖拽失败：回滚原列并显示错误", async () => {
    vi.stubGlobal("location", { ...window.location, search: "" })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: TASKS }))
      .mockResolvedValueOnce(mockResponse(422, { ok: false, error: { code: "invalid-transition", message: "invalid status transition" } }))
    vi.stubGlobal("fetch", fetchMock)
    render(<TasksModule />)
    await screen.findByText("导出 CSV")

    const todoCol = screen.getByRole("group", { name: "待处理" })
    const doingCol = screen.getByRole("group", { name: "进行中" })
    const card = screen.getByText("导出 CSV").closest("[draggable=true]")!
    const dataTransfer = { setData: vi.fn((_k: string, id: string) => (dataTransfer.value = id)), getData: () => dataTransfer.value as string, effectAllowed: "" }
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.dragOver(doingCol, { dataTransfer })
    fireEvent.drop(doingCol, { dataTransfer })

    await waitFor(() => expect(screen.getByText("invalid status transition")).toBeInTheDocument())
    expect(within(todoCol).getByText("导出 CSV")).toBeInTheDocument()
    expect(within(doingCol).queryByText("导出 CSV")).not.toBeInTheDocument()
  })

  it("加载失败显示错误与重试", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500, { ok: false, error: { code: "internal", message: "boom" } })))
    render(<TasksModule />)
    expect(await screen.findByText("boom")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })
})
```

注意：jsdom 的 DataTransfer 未实现，测试里用 `{ setData, getData, effectAllowed }` 闭包对象模拟；若 `closest("[draggable=true]")` 在 jsdom 不生效，给卡片元素加 `data-testid={`card-${t.id}`}` 作为拖拽起点。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus-tasks test`
Expected: 全部 PASS（jsdom 下 `draggable` 属性需要 `closest("[draggable=true]")` 命中；若 jsdom 不保留属性选择器，则给卡片加 `data-drag-id` 并改用 `data-testid` 作为 drag 起点——以实际测试修复为准）。

- [ ] **Step 5: Commit**

```bash
git add packages/octopus-tasks/web/src/components/TaskBoard.tsx packages/octopus-tasks/web/src/index.tsx packages/octopus-tasks/web/src/index.test.tsx
git commit -m "feat(octopus-tasks): kanban board with native html5 drag status moves"
```

---

## Task 10: DecomposeDraftsModal（AI 草稿 → 确认 → batch）

**Files:**
- Create: `packages/octopus-tasks/web/src/components/DecomposeDraftsModal.tsx`
- Modify: `packages/octopus-tasks/web/src/index.tsx`
- Modify: `packages/octopus-tasks/web/src/index.test.tsx`

**Interfaces:**
- Consumes: `decomposeTasks`/`createTaskBatch`/`currentProjectId`（api.ts）、`TaskDraft`（types.ts）
- Produces:
  - `DecomposeDraftsModal` props: `open`、`payload`（`{ requirementId; title; description?; priority? }`）、`submitting`、`drafts`（由父组件请求）、`onDraftChange`、`onClose`、`onSubmit`
  - 模块加载时消费 `window.__octopusDecomposePayload`（读后清空），非空则自动打开弹窗并请求 decompose
  - 后端契约：`POST /tasks/decompose` → `{ drafts: TaskDraft[] }`；`POST /tasks/batch` → `TaskRecord[]`

- [ ] **Step 1: 写 DecomposeDraftsModal.tsx**

```tsx
import { useEffect, useState } from "react"
import { Button, Input, Modal, Spinner } from "octopus-ui"
import type { TaskDraft } from "../types"

export interface DraftRow extends TaskDraft {
  key: number
  checked: boolean
}

export interface DecomposePayload {
  requirementId: string
  title: string
  description?: string
  priority?: "P0" | "P1" | "P2"
}

export interface DecomposeDraftsModalProps {
  open: boolean
  payload: DecomposePayload | null
  loading: boolean
  rows: DraftRow[]
  submitting: boolean
  error: string | null
  onRowChange: (key: number, patch: Partial<DraftRow>) => void
  onRetry: () => void
  onClose: () => void
  onSubmit: () => void
}

const PRIORITY_OPTIONS = ["P0", "P1", "P2"] as const

/** AI 拆解草稿确认弹窗：勾选/编辑草稿 → 批量创建（全有或全无） */
export function DecomposeDraftsModal({
  open,
  payload,
  loading,
  rows,
  submitting,
  error,
  onRowChange,
  onRetry,
  onClose,
  onSubmit,
}: DecomposeDraftsModalProps) {
  const [collapsed, setCollapsed] = useState<number | null>(null)
  useEffect(() => {
    if (!open) setCollapsed(null)
  }, [open])

  const canSubmit = rows.some((r) => r.checked && r.title.trim().length > 0) && !submitting

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !submitting && onClose()}
      title="拆解任务"
      description={payload ? `从需求 ${payload.title} 拆解出的任务草稿（AI 可编辑确认）` : "拆分任务草稿"}
    >
      {payload ? (
        <div className="space-y-3">
          <div className="text-xs text-text-faint">
            需求：{payload.title}
            {payload.priority ? ` · ${payload.priority}` : ""}
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <>
              {rows.map((row) => (
                <div key={row.key} className="rounded-xl border border-border bg-surface p-3">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) => onRowChange(row.key, { checked: e.target.checked })}
                    />
                    <span className="flex-1">
                      <Input
                        value={row.title}
                        aria-label={`任务标题 ${row.key}`}
                        onChange={(e) => onRowChange(row.key, { title: e.target.value })}
                        disabled={!row.checked}
                      />
                    </span>
                    <select
                      value={row.priority ?? "P1"}
                      aria-label={`优先级 ${row.key}`}
                      disabled={!row.checked}
                      onChange={(e) => onRowChange(row.key, { priority: e.target.value as TaskDraft["priority"] })}
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </>
          )}

          {error && !loading && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>}

          <div className="flex justify-end gap-2 pt-1">
            {loading && (
              <Button variant="ghost" size="sm" onClick={onRetry}>
                重新生成
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button variant="primary" disabled={!canSubmit} onClick={onSubmit}>
              {submitting ? "创建中…" : `创建任务（${rows.filter((r) => r.checked && r.title.trim()).length}）`}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
```

- [ ] **Step 2: 模块增加载荷消费与拆解状态机（index.tsx 修改，替换 header 区块与新增弹窗）**

在 `TasksModule` 内新增：

```tsx
  const [payload, setPayload] = useState<DecomposePayload | null>(null)
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftRows, setDraftRows] = useState<DraftRow[]>([])
  const [draftSubmitting, setDraftSubmitting] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  const openDrafts = useCallback(async (p: DecomposePayload) => {
    setPayload(p)
    setDraftOpen(true)
    setDraftError(null)
    setDraftLoading(true)
    try {
      const drafts = await decomposeTasks({
        requirementId: p.requirementId,
        title: p.title,
        description: p.description,
        priority: p.priority,
      })
      const rows = drafts.length > 0 ? drafts : [{ title: "" }]
      setDraftRows(rows.map((d) => ({ ...d, key: rowKeyRef.current++, checked: true })))
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e))
      setDraftRows([])
    } finally {
      setDraftLoading(false)
    }
  }, [])

  const rowKeyRef = useRef(0)

  // 消费 shell 写入的拆解载荷（读后清空，仅生效一次）
  useEffect(() => {
    const holder = window as unknown as { __octopusDecomposePayload?: DecomposePayload }
    const incoming = holder.__octopusDecomposePayload
    if (incoming) {
      holder.__octopusDecomposePayload = undefined
      void openDrafts(incoming)
    }
  }, [openDrafts])

  const handleSubmitDrafts = async () => {
    if (!payload) return
    setDraftSubmitting(true)
    setDraftError(null)
    setError(null)
    try {
      const tasks = draftRows
        .filter((r) => r.checked && r.title.trim().length > 0)
        .map((r) => ({
          title: r.title.trim(),
          priority: r.priority ?? "P1",
          assignee: r.assignee,
        }))
      const created = await createTaskBatch({
        requirementId: payload.requirementId,
        tasks,
      })
      setTasks((prev) => [...prev, ...created].sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5))))
      setDraftOpen(false)
      setPayload(null)
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e))
    } finally {
      setDraftSubmitting(false)
    }
  }
```

并渲染：

```tsx
      <DecomposeDraftsModal
        open={draftOpen}
        payload={payload}
        loading={draftLoading}
        rows={draftRows}
        submitting={draftSubmitting}
        error={draftError}
        onRowChange={(key, patch) =>
          setDraftRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
        }
        onRetry={() => payload && void openDrafts(payload)}
        onClose={() => {
          if (draftSubmitting) return
          setDraftOpen(false)
          setPayload(null)
        }}
        onSubmit={() => void handleSubmitDrafts()}
      />
```

导入行补：`import { DecomposeDraftsModal, type DecomposePayload, type DraftRow } from "./components/DecomposeDraftsModal"` 与 `import { createTaskBatch, decomposeTasks } from "./api"`。

- [ ] **Step 3: 追加拆解流程测试（index.test.tsx 内新增 describe）**

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

describe("TasksModule 拆解流程", () => {
  afterEach(() => {
    delete (window as unknown as { __octopusDecomposePayload?: unknown }).__octopusDecomposePayload
  })

  it("有载荷时自动 AI 拆解：草稿行 → 确认 → 批量创建并刷新看板", async () => {
    ;(window as unknown as { __octopusProjectId?: string }).__octopusProjectId = "p-alpha"
    ;(window as unknown as { __octopusDecomposePayload?: unknown }).__octopusDecomposePayload = {
      requirementId: "REQ-100",
      title: "OAuth 2.0 重构",
      priority: "P0",
      description: "无感登录",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: [] }))
      .mockResolvedValueOnce(mockResponse(200, {
        ok: true,
        data: {
          drafts: [
            { title: "排期与拆解 OAuth 2.0 重构", priority: "P0" },
            { title: "实现OAuth 2.0 重构 · 核心逻辑", priority: "P0" },
          ],
        },
      }))
      .mockResolvedValueOnce(mockResponse(201, {
        ok: true,
        data: [
          { id: "TASK-2800", title: "排期与拆解 OAuth 2.0 重构", description: "", requirementId: "REQ-100", projectId: "p-alpha", priority: "P0", status: "todo", assignee: null, createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
        ],
      }))
    vi.stubGlobal("fetch", fetchMock)

    render(<TasksModule />)
    expect(await screen.findByText("拆解任务")).toBeInTheDocument()

    await waitFor(() => expect(screen.getByLabelText("任务标题 0")).toHaveValue("排期与拆解 OAuth 2.0 重构"))
    // 取消勾选第二行
    const checkboxes = screen.getAllByRole("checkbox")
    await userEvent.click(checkboxes[1])

    await userEvent.click(screen.getByRole("button", { name: /创建任务/ }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/octopus-tasks/tasks/batch",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            requirementId: "REQ-100",
            projectId: "p-alpha",
            tasks: [{ title: "排期与拆解 OAuth 2.0 重构", priority: "P0" }],
          }),
        }),
      ),
    )
    await waitFor(() => expect(screen.getByText("排期与拆解 OAuth 2.0 重构")).toBeInTheDocument())
    // 载荷已消费
    expect((window as unknown as { __octopusDecomposePayload?: unknown }).__octopusDecomposePayload).toBeUndefined()
  })

  it("无载荷时不出弹窗", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { ok: true, data: [] })))
    render(<TasksModule />)
    expect(await screen.findByText("任务看板")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus-tasks test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/octopus-tasks/web/src/components/DecomposeDraftsModal.tsx packages/octopus-tasks/web/src/index.tsx packages/octopus-tasks/web/src/index.test.tsx
git commit -m "feat(octopus-tasks): decompose drafts modal with batch confirm"
```

---

## Task 11: octopus-ui bridge 常量（事件名 + 载荷类型）

**Files:**
- Create: `packages/octopus-ui/src/bridge.ts`
- Modify: `packages/octopus-ui/src/index.ts`

**Interfaces:**
- Consumes: 无
- Produces: `OCTOPUS_DECOMPOSE_EVENT: "octopus:decompose-request"`、`DecomposePayload`、`DecomposePayloadHolder`（供壳/需求插件/tasks 插件三方共享契约）

- [ ] **Step 1: 创建 bridge.ts**

```ts
/** 模块间解耦桥接：壳/插件通过 window 自定义事件与载荷传递上下文（契约层） */
export const OCTOPUS_DECOMPOSE_EVENT = "octopus:decompose-request" as const

export interface DecomposePayload {
  requirementId: string
  title: string
  description?: string
  priority?: "P0" | "P1" | "P2"
}

export type DecomposePayloadHolder = Window & { __octopusDecomposePayload?: DecomposePayload }
```

- [ ] **Step 2: 在 octopus-ui/src/index.ts 追加导出**

```ts
export {
  OCTOPUS_DECOMPOSE_EVENT,
  type DecomposePayload,
  type DecomposePayloadHolder,
} from "./bridge"
```

- [ ] **Step 3: 运行 octopus-ui 测试确认无回归**

Run: `pnpm --filter octopus-ui test`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/octopus-ui/src/bridge.ts packages/octopus-ui/src/index.ts
git commit -m "feat(octopus-ui): expose decompose bridge event contract"
```

---

## Task 12: 需求插件行内「拆解任务」入口（发事件）

**Files:**
- Modify: `packages/octopus-requirements/web/src/components/RequirementsTable.tsx`
- Modify: `packages/octopus-requirements/web/src/index.tsx`
- Modify: `packages/octopus-requirements/web/src/index.test.tsx`

**Interfaces:**
- Consumes: `OCTOPUS_DECOMPOSE_EVENT`（octopus-ui）
- Produces: 需求行操作按钮「拆解任务」（图标 `Layers`），`onDecompose(record)` prop；点击后 `window.dispatchEvent(CustomEvent(OCTOPUS_DECOMPOSE_EVENT, { detail: { requirementId, title, description, priority } }))`

- [ ] **Step 1: RequirementsTable.tsx 增加按钮与 prop**

行操作列内、编辑按钮左侧增加：

```tsx
<Button
  variant="ghost"
  size="sm"
  disabled={busy}
  aria-label={`拆解任务 ${r.id}`}
  title={`从 ${r.id} 拆解任务`}
  onClick={() => onDecompose(r)}
>
  <Layers className="h-3.5 w-3.5" />
</Button>
```

props 接口补 `onDecompose: (record: RequirementRecord) => void`；图标导入 `Layers` 加入 `import { Layers, Pencil, Trash2 } from "octopus-ui"`。

```tsx
export interface RequirementsTableProps {
  requirements: RequirementRecord[]
  onStatusChange: (id: string, status: RequirementStatus) => Promise<void> | void
  onDelete: (id: string) => Promise<void> | void
  onEdit: (record: RequirementRecord) => void
  onDecompose: (record: RequirementRecord) => void
  busyIds: ReadonlySet<string>
}
```

- [ ] **Step 2: index.tsx 实现 handleDecompose 并接线**

```tsx
import { OCTOPUS_DECOMPOSE_EVENT, type DecomposePayload } from "octopus-ui"

  const handleDecompose = (record: RequirementRecord) => {
    const detail: DecomposePayload = {
      requirementId: record.id,
      title: record.title,
      description: record.description || undefined,
      priority: record.priority,
    }
    window.dispatchEvent(new CustomEvent<DecomposePayload>(OCTOPUS_DECOMPOSE_EVENT, { detail }))
  }
```

并传给 `<RequirementsTable ... onDecompose={handleDecompose} />`。

- [ ] **Step 3: index.test.tsx 追加事件断言测试**

```tsx
describe("RequirementsModule 拆解入口", () => {
  it("点击行内拆解按钮派发 decompose 事件并携带需求上下文", async () => {
    const listener = vi.fn()
    window.addEventListener(OCTOPUS_DECOMPOSE_EVENT, listener as EventListener)
    vi.stubGlobal("fetch", mockList())
    render(<RequirementsModule />)
    await screen.findByText("OAuth 2.0 重构")

    await userEvent.click(screen.getByRole("button", { name: "拆解任务 REQ-100" }))

    expect(listener).toHaveBeenCalledTimes(1)
    const detail = (listener.mock.calls[0][0] as CustomEvent<DecomposePayload>).detail
    expect(detail).toMatchObject({
      requirementId: "REQ-100",
      title: "OAuth 2.0 重构",
      priority: "P0",
    })
    window.removeEventListener(OCTOPUS_DECOMPOSE_EVENT, listener as EventListener)
  })
})
```

文件顶部导入补：`import { OCTOPUS_DECOMPOSE_EVENT, type DecomposePayload } from "octopus-ui"`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus-requirements test`
Expected: 全部 PASS（requirements 单测 + 组件测试）。

- [ ] **Step 5: Commit**

```bash
git add packages/octopus-requirements/web/src/components/RequirementsTable.tsx packages/octopus-requirements/web/src/index.tsx packages/octopus-requirements/web/src/index.test.tsx
git commit -m "feat(octopus-requirements): row action to decompose tasks via bridge event"
```

---

## Task 13: 壳接线 TasksDrawer + 事件监听 + mock 清理

**Files:**
- Create: `packages/octopus/web/src/components/TasksDrawer.tsx`
- Modify: `packages/octopus/web/src/App.tsx`
- Modify: `packages/octopus/web/src/lib/types.ts`
- Modify: `packages/octopus/web/src/lib/datasource.ts`
- Modify: `packages/octopus/web/src/lib/datasource.test.ts`
- Modify: `packages/octopus/web/src/App.test.tsx`
- Delete: `packages/octopus/web/src/components/KanbanDrawer.tsx`
- Delete: `packages/octopus/web/src/components/KanbanDrawer.test.tsx`
- Delete: `packages/octopus/web/src/components/NewTaskModal.tsx`
- Delete: `packages/octopus/web/src/components/NewTaskModal.test.tsx`

**Interfaces:**
- Consumes: `OCTOPUS_DECOMPOSE_EVENT`/`DecomposePayload`/`DecomposePayloadHolder`（octopus-ui）
- Produces: `TasksDrawer({ open, onClose, entry })`；App 监听事件 → 写载荷 + `setDrawer("tasks")`

- [ ] **Step 1: 创建 TasksDrawer.tsx（镜像 RequirementsDrawer）**

```tsx
import { Component, lazy, Suspense, useMemo, type ReactNode } from "react"
import { Sheet } from "octopus-ui"
import { loadModule } from "../loadModule"

export interface TasksDrawerProps {
  open: boolean
  onClose: () => void
  entry: string | undefined
}

class DrawerErrorBoundary extends Component<{ children: ReactNode; title: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error(`[octopus] 任务看板模块加载失败: ${error.message}`)
  }

  render() {
    if (this.state.failed) return <div className="text-sm text-danger">模块「{this.props.title}」加载失败</div>
    return this.props.children
  }
}

function DrawerContent({ entry, title }: { entry: string; title: string }) {
  const Lazy = useMemo(() => lazy(() => loadModule(entry)), [entry])
  return (
    <DrawerErrorBoundary title={title}>
      <Suspense fallback={<div className="text-sm opacity-70">加载中…</div>}>
        <Lazy />
      </Suspense>
    </DrawerErrorBoundary>
  )
}

/** 任务看板：右侧抽屉加载 octopus-tasks 插件 UI */
export function TasksDrawer({ open, onClose, entry }: TasksDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="任务看板" subtitle="由 octopus-tasks 插件提供">
      {entry === undefined ? (
        <div className="text-sm text-danger">未安装任务模块</div>
      ) : (
        <DrawerContent entry={entry} title="任务看板" />
      )}
    </Sheet>
  )
}
```

- [ ] **Step 2: App.tsx 改造**

替换 import：`import { TasksDrawer } from "./components/TasksDrawer"`，删除 `KanbanDrawer` import 与 `KANBAN_COLUMNS` import。

删除 `const [columns, setColumns] = useState<KanbanColumn[]>(KANBAN_COLUMNS)` 与 `handleCreateTask` 函数；删除 `lib/types` 中 `KanbanColumn`/`KanbanTask` 导入。

新增 tasks entry 与事件监听：

```tsx
  const tasksEntry = useMemo(
    () => modules.find((m) => m.id === "tasks")?.entry,
    [modules],
  )

  useEffect(() => {
    const onDecompose = (event: Event) => {
      const detail = (event as CustomEvent<DecomposePayload>).detail
      ;(window as DecomposePayloadHolder).__octopusDecomposePayload = detail
      setDrawer("tasks")
    }
    window.addEventListener(OCTOPUS_DECOMPOSE_EVENT, onDecompose)
    return () => window.removeEventListener(OCTOPUS_DECOMPOSE_EVENT, onDecompose)
  }, [])
```

imports 补：`import { OCTOPUS_DECOMPOSE_EVENT, type DecomposePayload, type DecomposePayloadHolder } from "octopus-ui"`。

替换 JSX：

```tsx
            <TasksDrawer
              open={drawer === "tasks"}
              onClose={() => setDrawer(null)}
              entry={tasksEntry}
            />
```

（删除原 `<KanbanDrawer ... />` 块。）

- [ ] **Step 3: 清理 mock 类型与数据**

`lib/types.ts`：删除 `KanbanColumnKey`/`KanbanTask`/`KanbanColumn`/`NewTaskInput`（保留 `Priority` 与其他类型；若后续无引用，`Badge`/`BadgeTone` 保留——`PriorityCard` 仍在使用）。

`lib/datasource.ts`：删除 `KANBAN_TASKS`/`KANBAN_REVIEW`/`KANBAN_DONE`/`KANBAN_COLUMNS` 定义与导出；删除不再需要的 import（`KanbanColumn` 类型引用）。
`lib/datasource.test.ts`：删除 `kanban covers four columns in order` 用例及 `KANBAN_COLUMNS` import。

- [ ] **Step 4: 更新 App.test.tsx**

- 删除 275-286 行 `creates a task via kanban drawer` 用例（任务创建流程已移至插件级测试）。
- 「opens kanban drawer from strip and closes on Esc」用例不变（heading 由 Sheet 提供，module 未安装时显示兜底文案）。
- 新增用例：decompose 事件打开任务抽屉并写入载荷：

```tsx
  it("decompose bridge event opens tasks drawer with payload", async () => {
    mockedFetchProjects.mockResolvedValue([apiProject])
    const user = userEvent.setup()
    await renderApp()
    // 先收载荷进内存，再派发事件
    window.dispatchEvent(
      new CustomEvent(OCTOPUS_DECOMPOSE_EVENT, {
        detail: { requirementId: "REQ-100", title: "OAuth 2.0 重构", priority: "P0" },
      }),
    )
    await waitFor(() =>
      expect((window as unknown as { __octopusDecomposePayload?: unknown }).__octopusDecomposePayload).toMatchObject({
        requirementId: "REQ-100",
      }),
    )
    expect(await screen.findByRole("heading", { name: "任务看板" })).toBeInTheDocument()
    const holder = window as unknown as { __octopusDecomposePayload?: unknown }
    delete holder.__octopusDecomposePayload
  })
```

文件顶部导入补 `OCTOPUS_DECOMPOSE_EVENT`（from "octopus-ui"）。

- [ ] **Step 5: 删除文件并运行壳测试**

Run:

```bash
git rm packages/octopus/web/src/components/KanbanDrawer.tsx packages/octopus/web/src/components/KanbanDrawer.test.tsx packages/octopus/web/src/components/NewTaskModal.tsx packages/octopus/web/src/components/NewTaskModal.test.tsx
```

Run: `pnpm --filter octopus test`（或 `pnpm test` 在 packages/octopus 目录）
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/octopus/web/src
git commit -m "feat(octopus): wire tasks drawer module and remove kanban mock"
```

---

## Task 14: README + 全量构建验证

**Files:**
- Create: `packages/octopus-tasks/README.md`

**Interfaces:**
- Consumes: 最终产物
- Produces: 文档；全仓验证

- [ ] **Step 1: 写 README.md（参照 octopus-requirements README 风格）**

```markdown
# octopus-tasks

octopus 工作台的任务管理插件：任务只从需求拆解（AI 草稿 + 人工确认），4 列看板 + 拖拽迁卡。

## 数据

- 存储域：`octopus_tasks`（`~/.dsh/storages/octopus_tasks.json`，dsh storage-json）
- id：`TASK-<seq>`（默认起始 2800）
- 状态机：`todo → doing → review → done`（单向，done 终态）

## API

`/api/octopus-tasks`，统一响应 `{ ok: true, data }` / `{ ok: false, error: { code, message } }`

| Method | Path | 说明 |
|---|---|---|
| GET | /tasks?projectId=&requirementId=&status=&priority= | 列表（projectId 必填） |
| POST | /tasks | 单条创建 |
| POST | /tasks/batch | 批量创建（全有或全无，≤50） |
| POST | /tasks/decompose | AI 拆解草稿（当前为 mock 生成器，契约固定） |
| GET/PATCH/DELETE | /tasks/:id | 单条：读取/更新/删除 |

## 拆解链路

需求列表行内「拆解任务」→ `octopus:decompose-request` 事件（octopus-ui 契约）→ 壳打开任务抽屉并写入 `window.__octopusDecomposePayload` → 模块消费载荷弹出拆解弹窗 → batch 入库。

## 后续

agent 执行（工具注册/执行引擎）、真实 LLM 拆解替换 `generateTaskDrafts`。
```

- [ ] **Step 2: 全仓构建与测试**

Run: `pnpm build`
Expected: 全部包构建成功（octopus-ui → octopus → octopus-tasks 等）。

Run: `pnpm test`
Expected: 全部测试 PASS（含新增 tasks 套件、需求插件新用例、壳测试）。

- [ ] **Step 3: 手动冒烟（交付前由人类/执行者复核）**

1. `pnpm dev` → 打开 http://127.0.0.1:3080/workbench
2. 顶部项目条「任务看板」→ 出现 4 列（空态提示）
3. 「需求看板」→ 任意需求行 → 「拆解任务」→ 任务看板抽屉自动打开 → AI 拆解弹窗 → 确认创建 → 看板出现任务
4. 拖拽「待处理」卡片到「进行中」→ 迁移成功；重启 dsh → 数据仍在；非法拖拽（done 回退）→ 回滚 + 错误提示
5. 确认壳内无任务 mock 残留（`git grep KANBAN_ packages/octopus` 无输出）

- [ ] **Step 4: Commit**

```bash
git add packages/octopus-tasks/README.md
git commit -m "docs(octopus-tasks): readme for task plugin"
```

---

## Self-Review 记录

- **Spec 覆盖**：数据模型/状态机（T2/T3）✔；存储域（T2）✔；API 全部端点（T5）✔；batch 全有或全无（T4）✔；decompose mock 契约（T4/T5）✔；前端看板+拖拽（T9）✔；拆解弹窗+载荷消费（T10）✔；跨插件事件桥接（T11/T12/T13）✔；壳 TasksDrawer 与 mock 清理（T13）✔；README/挂载/验收（T14）✔；agent 非目标不涉及 ✔
- **占位符**：无 TBD/TODO；每步骤含实际代码
- **类型一致性**：`TaskInput`/`TaskDraft`/`TaskPatch`/`TaskRecord` 单边定义、host 与 web 双份（web 侧独立复制，与 requirements 模式一致）✔；`OCTOPUS_DECOMPOSE_EVENT`/`DecomposePayload` 仅在 octopus-ui 定义 ✔；`rowKey` 以 `useRef(0)` 实现（Task 10 已内联修正）✔
