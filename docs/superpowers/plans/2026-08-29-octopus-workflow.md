# octopus-workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主 agent 会话通过工具创建/查询需求、拆解并保存任务、为每个任务创建真实 AgentLoop 子会话执行并跟踪状态。

**Architecture:** 新插件包 `octopus-workflow`（纯服务，无 web 模块）依赖三个既有包的 store 服务（`ctx.provide` 暴露，因 storage-domain 单开语义不可重复 open）。主作用域 14 个工具经 `ctx.tools.register` 全局注册；任务子会话经 `ctx.agents.create/resume` 的 `setup(agentCtx)` 注入 2 个任务作用域工具 + `restrict` 屏蔽主工具，并在子会话 agent.ctx 上挂事件投影（环形缓冲）与审批监听。

**Tech Stack:** Node 22 / TS 5.6 / Cordis 4 / dsh-tools `defineTool`（JSON-schema 风格参数）/ dsh-agent `setup` / Vitest 4 + Testing Library

**Spec:** `docs/superpowers/specs/2026-08-29-octopus-workflow-design.md`

## Global Constraints

- dsh 版本族统一 `^0.1.1-rc.2`；`@deepseek-ai/cordis ^4.0.1`；zod 已由各包引入（octopus-tasks 用 `zod`，octopus-agent 用 `@deepseek-ai/schemastery`，各自保持）
- `storageDomain.open()` 单开：workflow 永不自行 open 任何域，只消费 `ctx.get("requirementStore" | "taskStore" | "projectStore")`
- 状态机不可违反：任务 `todo→doing→review→done` 单向；停止/重试的回退（doing→todo）只能走新增的内部方法 `TaskStore.reopen`，不进 REST
- `agentSessionId` / `agentSummary` 为服务端保留字段：REST 客户端不可写（不加入 `TaskPatch`），只经 `TaskStore.attachSession` / `setAgentSummary` 内部写入
- 工具名（14 个主工具 + 2 个子工具）与代码内 `MAIN_TOOL_NAMES` 一字不差，子会话 `restrict({ deny: MAIN_TOOL_NAMES })` 防嵌套
- 会话 id 前缀：主会话 `oct-`（octopus-agent 已用），任务子会话 `task-` + 8 位大写字母数字（`ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`）
- 新包 `octopus-workflow` 挂载顺序在 `octopus-agent` 之后；根 `package.json` dev/dev:noopen 脚本追加 `./packages/octopus-workflow`
- 包内文件模块后缀 `.js`（NodeNext ESM，与现有包一致）；所有工具错误经 `toolError()` 包装为 `[code] message` 格式抛出
- 构建产物不入库（`.gitignore` 已有 `packages/*/lib/` 等规则）

---

### Task 1: octopus-tasks — TaskRecord 扩展 + 内部写方法 + provide("taskStore")

**Files:**
- Modify: `packages/octopus-tasks/src/types.ts`
- Modify: `packages/octopus-tasks/src/unit.ts`
- Modify: `packages/octopus-tasks/src/store.ts`
- Modify: `packages/octopus-tasks/src/index.ts`
- Test: `packages/octopus-tasks/src/store.test.ts`（新增用例）

**Interfaces:**
- Consumes: 现有 `TaskRecord` / `TaskPatch` / `TasksError` / `assertTransition`、`TASKS_DOMAIN` 表结构
- Produces:
  - `TaskRecord` 增加 `agentSessionId?: string`、`agentSummary?: string`
  - `TaskStore.attachSession(id: string, sessionId: string | null): Promise<TaskRecord>`（`null` 清除）
  - `TaskStore.setAgentSummary(id: string, summary: string): Promise<TaskRecord>`
  - `TaskStore.reopen(id: string): Promise<TaskRecord>`（跳过迁移校验置回 todo）
  - `octopus-tasks` 包根导出类型：`export type { TaskRecord, TaskStatus, TaskDraft } from "./types.js"`
  - `ctx` 服务 `taskStore: TaskStore`（`declare module "@deepseek-ai/cordis"`）

- [ ] **Step 1: 扩展数据模型**

`packages/octopus-tasks/src/types.ts` 的 `TaskRecord` 增加两个可空字段：

```ts
export interface TaskRecord {
  id: string
  title: string
  description: string
  requirementId: string
  projectId: string
  status: TaskStatus
  /** 任务子会话 id（octopus-workflow 内部写入；REST 客户端不可指定） */
  agentSessionId?: string
  /** 子 agent 完成时自报的简短总结（octopus-workflow 内部写入） */
  agentSummary?: string
  createdAt: string
  updatedAt: string
}
```

`packages/octopus-tasks/src/unit.ts` 的 `taskSchema` 增加：

```ts
  agentSessionId: z.string().optional(),
  agentSummary: z.string().optional(),
```

- [ ] **Step 2: 新增内部写方法（store.ts）**

在 `TaskStore.update` 之后、`remove` 之前插入三个方法：

```ts
  /** 关联/解除任务子会话（workflow 内部专用：REST 不暴露）。sessionId 传 null 时清除关联 */
  async attachSession(id: string, sessionId: string | null): Promise<TaskRecord> {
    if (sessionId !== null && !sessionId.trim()) {
      throw new TasksError("invalid-input", "sessionId is required")
    }
    return this.setField(id, (record) => ({ ...record, agentSessionId: sessionId ?? undefined }))
  }

  /** 写入子 agent 自报总结（workflow 内部专用：REST 不暴露） */
  async setAgentSummary(id: string, summary: string): Promise<TaskRecord> {
    const text = summary.trim()
    if (!text) throw new TasksError("invalid-input", "summary is required")
    return this.setField(id, (record) => ({ ...record, agentSummary: text }))
  }

  /** 停止会话后回退到待处理（跳过迁移校验，仅 workflow 内部使用） */
  async reopen(id: string): Promise<TaskRecord> {
    if (!this.domain.table(TASK_TABLE).get(id)) {
      throw new TasksError("not-found", `task ${id} not found`)
    }
    return this.domain.table(TASK_TABLE).update(id, (current) => ({
      ...current,
      status: "todo",
      updatedAt: new Date().toISOString(),
    }))
  }

  /** 写链槽位内字段级更新（attachSession/setAgentSummary 共用） */
  private async setField(id: string, apply: (record: TaskRecord) => TaskRecord): Promise<TaskRecord> {
    if (!this.domain.table(TASK_TABLE).get(id)) {
      throw new TasksError("not-found", `task ${id} not found`)
    }
    return this.domain.table(TASK_TABLE).update(id, (current) => {
      const next = apply(current)
      return { ...next, updatedAt: new Date().toISOString() }
    })
  }
```

- [ ] **Step 3: 写失败测试（store.test.ts 末尾新增 describe）**

```ts
describe("TaskStore agent session fields", () => {
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

  it("attachSession 关联会话 id，重复调用覆盖", async () => {
    const task = await store.create({ title: "A", requirementId: "REQ-100", projectId: "p-alpha" })
    const linked = await store.attachSession(task.id, "task-AAAA1111")
    expect(linked.agentSessionId).toBe("task-AAAA1111")
    const relinked = await store.attachSession(task.id, "task-BBBB2222")
    expect(relinked.agentSessionId).toBe("task-BBBB2222")
    expect(store.get(task.id)?.updatedAt).toBe(relinked.updatedAt)
  })

  it("attachSession 传 null 清除关联；未知任务抛 not-found", async () => {
    const task = await store.create({ title: "A", requirementId: "REQ-100", projectId: "p-alpha" })
    await store.attachSession(task.id, "task-AAAA1111")
    const cleared = await store.attachSession(task.id, null)
    expect(cleared.agentSessionId).toBeUndefined()
    await expect(store.attachSession("TASK-9999", "task-AAAA1111")).rejects.toMatchObject({ code: "not-found" })
  })

  it("setAgentSummary 去空格写入；空串拒绝", async () => {
    const task = await store.create({ title: "A", requirementId: "REQ-100", projectId: "p-alpha" })
    const summarized = await store.setAgentSummary(task.id, "  完成了导出模块  ")
    expect(summarized.agentSummary).toBe("完成了导出模块")
    await expect(store.setAgentSummary(task.id, "   ")).rejects.toMatchObject({ code: "invalid-input" })
  })

  it("reopen 将 doing 回退 todo（不校验迁移），未知任务抛 not-found", async () => {
    const task = await store.create({ title: "A", requirementId: "REQ-100", projectId: "p-alpha" })
    await store.update(task.id, { status: "doing" })
    const reopened = await store.reopen(task.id)
    expect(reopened.status).toBe("todo")
    await expect(store.reopen("TASK-9999")).rejects.toMatchObject({ code: "not-found" })
  })
})
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm --filter octopus-tasks test`
Expected: FAIL —— `TaskStore` 无 `attachSession`/`setAgentSummary`/`reopen`（TypeScript 编译错误即视为失败，先跑 `pnpm --filter octopus-tasks exec tsc -p tsconfig.json --noEmit` 确认红，再继续 Step 5）。

- [ ] **Step 5: 接线 index.ts（provide + 类型导出 + 服务声明）**

`packages/octopus-tasks/src/index.ts` 修改：

```ts
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "@deepseek-ai/cordis"
import { serveStaticFiles } from "octopus"
import { createTaskApiHandler } from "./routes.js"
import { TaskStore } from "./store.js"

export type { TaskDraft, TaskRecord, TaskStatus } from "./types.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    taskStore: import("./store.js").TaskStore
  }
}
```

`apply` 的 effect 内 `const store = await TaskStore.open(ctx)` 之后加一行：

```ts
    ctx.provide("taskStore", store)
```

- [ ] **Step 6: 运行测试与构建**

Run: `pnpm --filter octopus-tasks test`
Expected: PASS（既有用例 + 新用例全部通过）
Run: `pnpm --filter octopus-tasks build`
Expected: 构建成功（src 与 web 均产出）

- [ ] **Step 7: Commit**

```bash
git add packages/octopus-tasks/src/types.ts packages/octopus-tasks/src/unit.ts packages/octopus-tasks/src/store.ts packages/octopus-tasks/src/index.ts packages/octopus-tasks/src/store.test.ts
git commit -m "feat(octopus-tasks): agent session fields + internal write methods + taskStore service"
```

---

### Task 2: octopus-requirements — provide("requirementStore")

**Files:**
- Modify: `packages/octopus-requirements/src/index.ts`
- Test: `packages/octopus-requirements/src/index.test.ts`（新建）

**Interfaces:**
- Consumes: `RequirementStore`（现有）、`Context`
- Produces:
  - `octopus-requirements` 包根导出类型：`export type { RequirementInput, RequirementPatch, RequirementRecord, RequirementSource, RequirementStatus } from "./types.js"`
  - `ctx` 服务 `requirementStore: RequirementStore`（`declare module "@deepseek-ai/cordis"`）

- [ ] **Step 1: 修改 index.ts**

`packages/octopus-requirements/src/index.ts` 顶部 import 之后追加：

```ts
export type {
  Priority,
  RequirementInput,
  RequirementPatch,
  RequirementRecord,
  RequirementSource,
  RequirementStatus,
} from "./types.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    requirementStore: import("./store.js").RequirementStore
  }
}
```

`apply` 的 effect 内 `const store = await RequirementStore.open(ctx)` 之后加一行：

```ts
    ctx.provide("requirementStore", store)
```

- [ ] **Step 2: 写接线冒烟测试（新建 index.test.ts）**

```ts
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import Storage from "@deepseek-ai/dsh-storage"
import * as JsonStorage from "@deepseek-ai/dsh-storage-json"
import * as DomainStorage from "@deepseek-ai/dsh-storage-domain"
import plugin from "./index.js"

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

describe("octopus-requirements index", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>

  beforeEach(async () => {
    harness = await createHarness()
  })

  afterEach(async () => {
    await harness.ctx.stop()
    await rm(harness.root, { recursive: true, force: true })
  })

  it("provide requirementStore 服务可注入可用", async () => {
    const store = harness.ctx.get("requirementStore")
    expect(store).toBeDefined()
    const record = await store.create({ title: "冒烟需求", projectId: "p-alpha" })
    expect(record.id).toBe("REQ-100")
    expect(harness.ctx.get("requirementStore").get(record.id)?.title).toBe("冒烟需求")
  })
})
```

> 若 `ctx.plugin(plugin as never)` 类型不顺，可改 `await ctx.plugin(plugin as unknown as Parameters<Context["plugin"]>[0])`。`ctx.stop()` 会等待 effect 清理（含 `store.close()`）。

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter octopus-requirements test`
Expected: PASS（既有用例 + 新冒烟用例）
Run: `pnpm --filter octopus-requirements build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add packages/octopus-requirements/src/index.ts packages/octopus-requirements/src/index.test.ts
git commit -m "feat(octopus-requirements): expose requirementStore service on ctx"
```

---

### Task 3: octopus-projects — createProjectStore 只读服务

**Files:**
- Create: `packages/octopus-projects/src/service.ts`
- Create: `packages/octopus-projects/src/service.test.ts`
- Modify: `packages/octopus-projects/src/index.ts`

**Interfaces:**
- Consumes: `ProjectsTableLike`、`ProjectRecord`（api.ts / domain.ts）
- Produces:
  - `createProjectStore(projects: ProjectsTableLike): ProjectStoreLike`
  - `interface ProjectStoreLike { list(): ProjectView[]; get(id: string): ProjectView | undefined }`（`ProjectView = ProjectRecord & { id: string }`）
  - `octopus-projects` 包根导出 `createProjectStore` / `ProjectStoreLike` / `ProjectView`
  - `ctx` 服务 `projectStore: ProjectStoreLike`

- [ ] **Step 1: 写失败测试（新建 service.test.ts）**

```ts
import { describe, expect, it } from "vitest"
import type { ProjectsTableLike } from "./api.js"
import { createProjectStore } from "./service.js"

function fakeTable(records: Record<string, Parameters<ProjectsTableLike["put"]>[1]>): ProjectsTableLike {
  return {
    get: (id) => records[id],
    entries: function* () {
      for (const [id, record] of Object.entries(records)) yield [id, record]
    },
    put: async () => {},
    delete: async () => true,
  }
}

const BASE = {
  name: "Alpha",
  description: "",
  status: "active" as const,
  workspacePath: "C:/projects/alpha",
  workspaceId: "ws-1",
  createdAt: "2026-08-26T00:00:00.000Z",
}

describe("createProjectStore", () => {
  it("list 返回 id+record 视图，按 createdAt 倒序", () => {
    const store = createProjectStore(fakeTable({
      "prjA": { ...BASE, name: "Alpha", createdAt: "2026-08-26T00:00:00.000Z" },
      "prjB": { ...BASE, name: "Beta", createdAt: "2026-08-27T00:00:00.000Z" },
    }))
    const items = store.list()
    expect(items.map((p) => p.id)).toEqual(["prjB", "prjA"])
    expect(items[0]).toMatchObject({ id: "prjB", name: "Beta", workspacePath: "C:/projects/alpha" })
  })

  it("get 返回带 id 的视图；未知 id 返回 undefined", () => {
    const store = createProjectStore(fakeTable({ "prjA": { ...BASE } }))
    expect(store.get("prjA")?.id).toBe("prjA")
    expect(store.get("prjZ")).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus-projects test`
Expected: FAIL（`./service.js` 不存在）

- [ ] **Step 3: 实现 service.ts**

```ts
import type { ProjectsTableLike, ProjectView } from "./api.js"

export interface ProjectStoreLike {
  list(): ProjectView[]
  get(id: string): ProjectView | undefined
}

/** 项目只读视图服务（供 octopus-workflow 工具查询 workspacePath 等；写操作仍走 REST） */
export function createProjectStore(projects: ProjectsTableLike): ProjectStoreLike {
  return {
    list() {
      return [...projects.entries()]
        .map(([id, record]) => ({ id, ...record }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    get(id) {
      const record = projects.get(id)
      return record ? { id, ...record } : undefined
    },
  }
}
```

（`ProjectView` 已在 `api.ts` 导出，直接复用。）

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter octopus-projects test`
Expected: PASS

- [ ] **Step 5: 接线 index.ts**

`packages/octopus-projects/src/index.ts` 修改：
- 顶部加 `import { createProjectStore } from "./service.js"` 与 `export { createProjectStore, type ProjectStoreLike, type ProjectView } from "./service.js"`
- 加 declare module（与既有 `storageDomain` 声明并列）：

```ts
declare module "@deepseek-ai/cordis" {
  interface Context {
    storageDomain: import("@deepseek-ai/dsh-storage-domain").DomainFacility
    workspaceRegistry: import("@deepseek-ai/dsh-workspace").WorkspaceRegistry
    projectStore: import("./service.js").ProjectStoreLike
  }
}
```

- `apply` 内构造 `deps` 成功后（`deps = {...}` 赋值之后、`createProjectsHandler(deps)` 之前）加：

```ts
    ctx.provide("projectStore", createProjectStore(deps.projects))
```

- [ ] **Step 6: 构建与测试**

Run: `pnpm --filter octopus-projects test`
Expected: PASS
Run: `pnpm --filter octopus-projects build`
Expected: 构建成功

- [ ] **Step 7: Commit**

```bash
git add packages/octopus-projects/src/service.ts packages/octopus-projects/src/service.test.ts packages/octopus-projects/src/index.ts
git commit -m "feat(octopus-projects): read-only projectStore service for workflow tools"
```

---

### Task 4: octopus-workflow 脚手架

**Files:**
- Create: `packages/octopus-workflow/package.json`
- Create: `packages/octopus-workflow/cordis.patch.yml`
- Create: `packages/octopus-workflow/tsconfig.json`
- Create: `packages/octopus-workflow/tsconfig.build.json`
- Create: `packages/octopus-workflow/vitest.config.ts`
- Create: `packages/octopus-workflow/src/types.ts`
- Create: `packages/octopus-workflow/src/types.test.ts`

**Interfaces:**
- Consumes: `octopus-tasks` / `octopus-requirements` / `octopus-projects` 的根导出类型（Task 1-3 产物）
- Produces:
  - `TaskSessionEvent` 联合类型（环形缓冲条目）
  - `RequirementStoreLike` / `TaskStoreLike` / `ProjectStoreLike` / `TaskSessionLike` / `TaskSessionStatus`（结构性接口，供 manager/tools 测试替身与真实 store 双兼容）
  - `WorkflowError`（code: `"task-not-found" | "project-not-found" | "session-unavailable" | "invalid-input"`）

- [ ] **Step 1: package.json**

```json
{
  "name": "octopus-workflow",
  "version": "0.1.0",
  "description": "Agent workflow orchestration plugin for the octopus workbench",
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
    "cordis.patch.yml",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@deepseek-ai/dsh-llm": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-tools": "^0.1.1-rc.2",
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "octopus-projects": "^0.1.0",
    "octopus-requirements": "^0.1.0",
    "octopus-tasks": "^0.1.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@types/node": "^22.0.0",
    "octopus-projects": "file:../octopus-projects",
    "octopus-requirements": "file:../octopus-requirements",
    "octopus-tasks": "file:../octopus-tasks",
    "typescript": "^5.6.0",
    "vitest": "^4.1.8"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

- [ ] **Step 2: cordis.patch.yml / tsconfig / vitest**

`cordis.patch.yml`（复制 octopus-agent 样式）：

```yaml
- insert:
    - id: octopus-workflow
      name: octopus-workflow
```

`tsconfig.json`（复制 octopus-agent 的）：

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

`tsconfig.build.json`（复制 octopus-agent 的）：

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

`vitest.config.ts`（复制 octopus-agent 的）：

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
})
```

- [ ] **Step 3: 写失败测试（types.test.ts）**

```ts
import { describe, expect, it } from "vitest"
import { WorkflowError } from "./types.js"

describe("WorkflowError", () => {
  it("携带 code 与 message", () => {
    const err = new WorkflowError("task-not-found", "task TASK-1 not found")
    expect(err.code).toBe("task-not-found")
    expect(err.message).toContain("TASK-1")
    expect(err).toBeInstanceOf(Error)
  })
})
```

- [ ] **Step 4: 实现 types.ts**

```ts
import type { ProjectView } from "octopus-projects"
import type { RequirementRecord } from "octopus-requirements"
import type { TaskPatch, TaskRecord } from "octopus-tasks"

/** 任务子会话事件（环形缓冲条目；镜像 octopus-agent AgentStreamEvent 的最小版） */
export type TaskSessionEvent =
  | { type: "status"; status: "idle" | "running" }
  | { type: "user-message"; text: string }
  | { type: "assistant-text"; text: string }
  | { type: "tool-call"; name: string; summary: string }
  | { type: "tool-result"; name: string; ok: boolean; preview: string }
  | { type: "turn"; at: "start" | "end"; reason?: string }
  | { type: "error"; message: string }

export interface RequirementStoreLike {
  get(id: string): RequirementRecord | undefined
}

export interface TaskStoreLike {
  get(id: string): TaskRecord | undefined
  update(id: string, patch: TaskPatch): Promise<TaskRecord>
  attachSession(id: string, sessionId: string | null): Promise<TaskRecord>
  setAgentSummary(id: string, summary: string): Promise<TaskRecord>
  reopen(id: string): Promise<TaskRecord>
}

export interface ProjectStoreLike {
  get(id: string): ProjectView | undefined
}

export interface TaskSessionLike {
  start(taskId: string): Promise<{ sessionId: string; task: TaskRecord }>
  stop(taskId: string): Promise<TaskRecord>
  send(taskId: string, message: string): Promise<void>
  status(taskId: string): Promise<TaskSessionStatus>
}

export interface TaskSessionStatus {
  task: TaskRecord
  session: { sessionId: string | null; live: boolean; status?: "idle" | "running" }
  events: TaskSessionEvent[]
}

/** 子会话作用域上下文最小面（buildTaskSetup 注入工具/restrict 的挂载点；与真实 agentCtx 结构兼容） */
export interface AgentCtxLike {
  tools: {
    register(definition: unknown): unknown
    restrict(filter: { allow?: string[]; deny?: string[] }): unknown
  }
}

export type WorkflowErrorCode = "task-not-found" | "project-not-found" | "session-unavailable" | "invalid-input"

export class WorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "WorkflowError"
  }
}
```

> 说明：`TaskPatch` 从 `octopus-tasks` 根导入（Task 1 已导出）；若类型导入在 `skipLibCheck` 下报 resolution 错误，先确认 Task 1-3 已完成 build（`lib/types` 存在）。

- [ ] **Step 5: 安装依赖并运行测试**

Run: `pnpm install`
Run: `pnpm --filter octopus-workflow test`
Expected: PASS
Run: `pnpm --filter octopus-workflow build`
Expected: 构建成功

- [ ] **Step 6: Commit**

```bash
git add packages/octopus-workflow
git commit -m "chore(octopus-workflow): scaffold plugin package with shared types"
```

---

### Task 5: octopus-workflow — sync.ts 事件投影纯函数

**Files:**
- Create: `packages/octopus-workflow/src/sync.ts`
- Create: `packages/octopus-workflow/src/sync.test.ts`

**Interfaces:**
- Consumes: `TaskSessionEvent`（types.ts，Task 4）
- Produces:
  - `interface SessionEventLike { seq: number; type: string; data: Record<string, unknown> }`
  - `interface ProjectState { callNames: Map<string, string> }` + `createProjectState(): ProjectState`
  - `projectEvents(st: ProjectState, ev: SessionEventLike): TaskSessionEvent[]`
  - `appendEvent(buffer: TaskSessionEvent[], event: TaskSessionEvent, max?: number): TaskSessionEvent[]`（默认 `EVENT_BUFFER_MAX = 100`）
  - `tailEvents(buffer: TaskSessionEvent[], n?: number): TaskSessionEvent[]`（默认 `EVENT_TAIL = 15`）
  - `export const EVENT_BUFFER_MAX` / `EVENT_TAIL`

- [ ] **Step 1: 写失败测试（sync.test.ts）**

```ts
import { describe, expect, it } from "vitest"
import { appendEvent, createProjectState, projectEvents, tailEvents, type SessionEventLike } from "./sync.js"

const ev = (type: string, data: Record<string, unknown> = {}, seq = 1): SessionEventLike => ({ seq, type, data })

describe("projectEvents", () => {
  it("user/message 投影（过滤 plugin 来源）", () => {
    const st = createProjectState()
    expect(projectEvents(st, ev("user/message", { text: "你好" }))).toEqual([{ type: "user-message", text: "你好" }])
    expect(projectEvents(st, ev("user/message", { source: { kind: "plugin" }, text: "x" }))).toEqual([])
    expect(projectEvents(st, ev("user/message", { content: [{ type: "text", text: "内容" }] }))).toEqual([{ type: "user-message", text: "内容" }])
  })

  it("assistant/message 逐块投影 text 与 tool-call（记录 callId→name 映射）", () => {
    const st = createProjectState()
    const events = projectEvents(st, ev("assistant/message", {
      message: {
        content: [
          { type: "text", text: "开始" },
          { type: "tool-call", id: "call-1", name: "create_requirement", arguments: '{"title":"x"}' },
        ],
      },
    }))
    expect(events).toEqual([
      { type: "assistant-text", text: "开始" },
      { type: "tool-call", name: "create_requirement", summary: expect.stringContaining("create") },
    ])
    expect(st.callNames.get("call-1")).toBe("create_requirement")
  })

  it("tool/result 用 callNames 反查名；error 存在时 ok=false", () => {
    const st = createProjectState()
    st.callNames.set("call-1", "list_tasks")
    expect(projectEvents(st, ev("tool/result", { message: { content: [{ toolCallId: "call-1", content: ["ok"] }] } }))).toEqual([
      { type: "tool-result", name: "list_tasks", ok: true, preview: expect.stringContaining("ok") },
    ])
    expect(projectEvents(st, ev("tool/result", { error: {}, message: { content: [] } }))).toEqual([
      { type: "tool-result", name: "tool", ok: false, preview: expect.stringContaining("[]") },
    ])
  })

  it("turn/start、turn/end（reason 透传）、未知类型返回空数组", () => {
    const st = createProjectState()
    expect(projectEvents(st, ev("turn/start"))).toEqual([{ type: "turn", at: "start" }])
    expect(projectEvents(st, ev("turn/end", { reason: { kind: "completed" } }))).toEqual([{ type: "turn", at: "end", reason: "completed" }])
    expect(projectEvents(st, ev("whatever/unknown"))).toEqual([])
  })
})

describe("appendEvent / tailEvents", () => {
  it("appendEvent 超限裁剪头部", () => {
    const buffer = [] as { type: "status"; status: "idle" }[]
    let current: { type: "status"; status: "idle" }[] = buffer
    for (let i = 0; i < 103; i += 1) current = appendEvent(current, { type: "status", status: "idle" }, 100)
    expect(current).toHaveLength(100)
    expect(tailEvents(current, 3)).toHaveLength(3)
  })

  it("tailEvents 默认取尾 15 条", () => {
    const buffer = Array.from({ length: 30 }, (_, i) => ({ type: "status" as const, status: "idle" as const }))
    expect(tailEvents(buffer)).toHaveLength(15)
    expect(tailEvents(buffer, 100)).toHaveLength(30)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus-workflow test`
Expected: FAIL（`./sync.js` 不存在）

- [ ] **Step 3: 实现 sync.ts**

```ts
import type { TaskSessionEvent } from "./types.js"

export interface SessionEventLike {
  seq: number
  type: string
  data: Record<string, unknown>
}

export interface ProjectState { callNames: Map<string, string> }
export function createProjectState(): ProjectState { return { callNames: new Map() } }

export const EVENT_BUFFER_MAX = 100
export const EVENT_TAIL = 15

const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)

function blockSummary(block: { arguments?: unknown }): string {
  const raw = typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments ?? {})
  return clamp(raw, 160)
}

function reasonText(reason: unknown): string {
  if (typeof reason === "string") return reason
  if (typeof reason === "object" && reason !== null && typeof (reason as { kind?: unknown }).kind === "string") {
    return (reason as { kind: string }).kind
  }
  return JSON.stringify(reason)
}

/** 单个原始会话事件 → 任务会话事件投影（纯函数；assistant/message 逐块产出多条） */
export function projectEvents(st: ProjectState, raw: SessionEventLike): TaskSessionEvent[] {
  const d = raw.data
  switch (raw.type) {
    case "user/message": {
      if ((d.source as { kind?: unknown } | undefined)?.kind === "plugin") return []
      let text = ""
      if (typeof d.text === "string") text = d.text
      else if (Array.isArray(d.content)) {
        const first = d.content[0]
        if (typeof first === "object" && first !== null && typeof (first as { text?: unknown }).text === "string") {
          text = (first as { text: string }).text
        }
      }
      return [{ type: "user-message", text }]
    }
    case "assistant/message": {
      const message = d.message as { content?: unknown } | undefined
      const content = message?.content
      if (!Array.isArray(content)) return []
      const out: TaskSessionEvent[] = []
      for (const block of content) {
        if (typeof block !== "object" || block === null) continue
        const b = block as { type?: unknown }
        if (b.type === "text" && typeof (block as { text?: unknown }).text === "string") {
          out.push({ type: "assistant-text", text: (block as { text: string }).text })
        } else if (b.type === "tool-call") {
          const call = block as { id?: unknown; name?: unknown; arguments?: unknown }
          const id = String(call.id ?? "")
          const name = String(call.name ?? "tool")
          st.callNames.set(id, name)
          out.push({ type: "tool-call", name, summary: blockSummary(call) })
        }
      }
      return out
    }
    case "turn/start":
      return [{ type: "turn", at: "start" }]
    case "turn/end": {
      const out: TaskSessionEvent = { type: "turn", at: "end" }
      if (d.reason !== undefined) out.reason = reasonText(d.reason)
      return [out]
    }
    case "tool/result": {
      const content = (d.message as { content?: unknown } | undefined)?.content
      const first = Array.isArray(content) ? content[0] : undefined
      const block = first && typeof first === "object"
        ? first as { toolCallId?: unknown; content?: unknown }
        : undefined
      const callId = String(block?.toolCallId ?? "")
      return [{
        type: "tool-result",
        name: st.callNames.get(callId) ?? "tool",
        ok: d.error === undefined,
        preview: clamp(JSON.stringify(block?.content ?? []), 200),
      }]
    }
    default:
      return []
  }
}

/** 环形缓冲追加（超限裁剪头部，纯函数返回新数组） */
export function appendEvent<T>(buffer: T[], event: T, max = EVENT_BUFFER_MAX): T[] {
  const next = [...buffer, event]
  return next.length > max ? next.slice(next.length - max) : next
}

/** 取缓冲尾部 n 条摘要 */
export function tailEvents<T>(buffer: T[], n = EVENT_TAIL): T[] {
  return buffer.slice(Math.max(0, buffer.length - n))
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter octopus-workflow test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/octopus-workflow/src/sync.ts packages/octopus-workflow/src/sync.test.ts
git commit -m "feat(octopus-workflow): session event projection and ring buffer"
```

---

### Task 6: octopus-workflow — TaskSessionManager

**Files:**
- Create: `packages/octopus-workflow/src/manager.ts`
- Create: `packages/octopus-workflow/src/manager.test.ts`

**Interfaces:**
- Consumes: `TaskSessionEvent` / `TaskStoreLike` / `RequirementStoreLike` / `ProjectStoreLike` / `WorkflowError`（types.ts）、`createProjectState` / `projectEvents` / `appendEvent` / `tailEvents` / `SessionEventLike`（sync.ts）、`createUserMessage`（`@deepseek-ai/dsh-llm`）
- Produces:
  - `createTaskSessionId(): string`（`task-` 前缀 + 8 位随机）
  - `class TaskSessionManager`（构造 `ManagerDeps`；方法 `start / stop / send / status / withdraw`；`setNowSource(fn)` 供测试）
  - `interface ManagerDeps { agents; taskStore; requirementStore; projectStore; sessionIdFactory; defaultCwd: string | null; defaultAgentPreset; provider?; model?; approval: "allow" | "never"; buildTaskSetup(taskId: string): (agentCtx: unknown) => void }`
  - `interface AgentHandleLike { agent: AgentLike; dispose(): Promise<void> }`、`AgentLike { id; status; ctx.on; followup; cancel }`、`AgentsLike { create({sessionId, meta?, agentOptions?, setup?}); resume({resumeSessionId, agentOptions?, setup?}) }`

**语义（与 spec 一致）：**
- `start(taskId)`：已 live 直接返回；任务不存在抛 `task-not-found`；有 `agentSessionId` 走 `agents.resume`（不 re-kick），无则创建（`meta: { cwd, agentPreset, taskId }` + `setup`）+ `attachSession`；任务 todo 时自动置 doing；创建后 kick 启动消息
- `stop(taskId)`：live 则 `cancel({kind:"user"})` + dispose；`attachSession(taskId, null)` 解绑；`reopen(taskId)` 回 todo
- `send(taskId, message)`：无会话抛 `session-unavailable`；entry 不在则 `agents.resume` 后 followup
- `status(taskId)`：只读，不 resume；events 取 tail 15
- 子会话审批监听：`approval/request` 恒返回 `"allowed-once"`（allow）或 `"rejected"`（never）

- [ ] **Step 1: 写失败测试（manager.test.ts）**

```ts
import { describe, expect, it, vi } from "vitest"
import { TaskSessionManager, createTaskSessionId, type AgentHandleLike, type AgentLike, type AgentsLike, type ManagerDeps } from "./manager.js"
import type { RequirementRecord } from "octopus-requirements"
import type { TaskRecord } from "octopus-tasks"
import type { ProjectView } from "octopus-projects"

function fakeAgent(id: string, status: "idle" | "running" = "idle"): AgentLike & { emit(event: string, ...args: unknown[]): unknown } {
  const listeners: Record<string, (listenerArgs: unknown[]) => unknown> = {}
  const agent: AgentLike = {
    id,
    get status() { return status },
    ctx: {
      on(event: string, listener: (...args: unknown[]) => unknown): number {
        listeners[event] = listener
        return 0
      },
    },
    followup: vi.fn(),
    cancel: vi.fn(),
  }
  return Object.assign(agent, {
    emit(event: string, ...args: unknown[]): unknown {
      const listener = listeners[event]
      if (!listener) return undefined
      return (listener as (...a: unknown[]) => unknown)(...args)
    },
  })
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "TASK-2800", title: "实现导出", description: "支持 CSV",
    requirementId: "REQ-100", projectId: "prjA", status: "todo",
    createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  }
}

const makeRequirement = (): RequirementRecord => ({
  id: "REQ-100", title: "导出报表", description: "分页", priority: "P1",
  status: "planned", projectId: "prjA", source: "chat",
  createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
})

const makeProject = (): ProjectView => ({
  id: "prjA", name: "Alpha", description: "", status: "active",
  workspacePath: "C:/projects/alpha", workspaceId: "ws-1", createdAt: "2026-08-26T00:00:00.000Z",
})

function makeHarness(opts: { approval?: "allow" | "never" } = {}) {
  const tasks = new Map<string, TaskRecord>()
  const taskStore = {
    get: (id: string) => tasks.get(id),
    update: async (id: string, patch: Partial<TaskRecord>) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      return next
    },
    attachSession: async (id: string, sessionId: string | null) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next = { ...current, agentSessionId: sessionId ?? undefined, updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      return next
    },
    setAgentSummary: async (id: string, summary: string) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next = { ...current, agentSummary: summary, updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      return next
    },
    reopen: async (id: string) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next = { ...current, status: "todo", updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      return next
    },
  }
  const requirementStore = { get: (id: string) => (id === "REQ-100" ? makeRequirement() : undefined) }
  const projectStore = { get: (id: string) => (id === "prjA" ? makeProject() : undefined) }
  const agents: AgentsLike = {
    create: vi.fn(async (options: { sessionId: string }): Promise<AgentHandleLike> => {
      return { agent: fakeAgent(options.sessionId), dispose: vi.fn(async () => {}) }
    }),
    resume: vi.fn(async (options: { resumeSessionId: string }): Promise<AgentHandleLike> => {
      return { agent: fakeAgent(options.resumeSessionId), dispose: vi.fn(async () => {}) }
    }),
  }
  let seq = 0
  const manager = new TaskSessionManager({
    agents,
    taskStore,
    requirementStore,
    projectStore,
    sessionIdFactory: () => `task-${String(++seq).padStart(8, "A")}`,
    defaultCwd: null,
    defaultAgentPreset: "standard",
    provider: undefined,
    model: undefined,
    approval: opts.approval ?? "allow",
    buildTaskSetup: () => () => {},
  })
  return { manager, agents, taskStore, tasks }
}

describe("TaskSessionManager", () => {
  it("start 创建会话：meta 携带 cwd/taskId、attachSession 关联、todo→doing、kick 消息含任务标题", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    const result = await h.manager.start("TASK-2800")
    expect(result.sessionId).toMatch(/^task-/)
    expect(h.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: result.sessionId,
      meta: expect.objectContaining({ cwd: "C:/projects/alpha", agentPreset: "standard", taskId: "TASK-2800" }),
      setup: expect.any(Function),
    }))
    expect(h.tasks.get("TASK-2800")?.agentSessionId).toBe(result.sessionId)
    expect(h.tasks.get("TASK-2800")?.status).toBe("doing")
    const handle = (await h.agents.create.mock.results[0].value) as AgentHandleLike
    expect(handle.agent.followup).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.arrayContaining([expect.objectContaining({
        text: expect.stringContaining("实现导出"),
      })]),
    }))
  })

  it("start 对已 live 的任务幂等返回；不重复创建", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    const first = await h.manager.start("TASK-2800")
    const second = await h.manager.start("TASK-2800")
    expect(second.sessionId).toBe(first.sessionId)
    expect(h.agents.create).toHaveBeenCalledTimes(1)
    expect(h.agents.resume).not.toHaveBeenCalled()
  })

  it("start 对已有 agentSessionId 的任务走 resume，不 kick", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask({ agentSessionId: "task-AAAA1111", status: "doing" }))
    const result = await h.manager.start("TASK-2800")
    expect(result.sessionId).toBe("task-AAAA1111")
    expect(h.agents.create).not.toHaveBeenCalled()
    expect(h.agents.resume).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: "task-AAAA1111",
    }))
    const handle = (await h.agents.resume.mock.results[0].value) as AgentHandleLike
    expect(handle.agent.followup).not.toHaveBeenCalled()
  })

  it("start 未知任务抛 task-not-found", async () => {
    const h = makeHarness()
    await expect(h.manager.start("TASK-9999")).rejects.toMatchObject({ code: "task-not-found" })
  })

  it("stop 取消+释放会话、解绑 agentSessionId、回退 todo", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    await h.manager.start("TASK-2800")
    const handle = (await h.agents.create.mock.results[0].value) as AgentHandleLike
    const stopped = await h.manager.stop("TASK-2800")
    expect(handle.agent.cancel).toHaveBeenCalledWith({ kind: "user" })
    expect(handle.dispose).toHaveBeenCalled()
    expect(stopped.status).toBe("todo")
    expect(stopped.agentSessionId).toBeUndefined()
    expect(h.tasks.get("TASK-2800")?.agentSessionId).toBeUndefined()
  })

  it("send 对 live 会话 followup；无会话抛 session-unavailable", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    await h.manager.start("TASK-2800")
    const handle = (await h.agents.create.mock.results[0].value) as AgentHandleLike
    await h.manager.send("TASK-2800", "补充要求")
    expect(handle.agent.followup).toHaveBeenCalledTimes(2)
    await expect(h.manager.send("TASK-9999", "x")).rejects.toMatchObject({ code: "task-not-found" })
    h.tasks.set("TASK-2801", makeTask({ id: "TASK-2801" }))
    await expect(h.manager.send("TASK-2801", "x")).rejects.toMatchObject({ code: "session-unavailable" })
  })

  it("send 对持久化但未加载的任务自动 resume 后 followup", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask({ agentSessionId: "task-AAAA1111", status: "doing" }))
    await h.manager.send("TASK-2800", "继续")
    expect(h.agents.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: "task-AAAA1111" }))
    const handle = (await h.agents.resume.mock.results[0].value) as AgentHandleLike
    expect(handle.agent.followup).toHaveBeenCalled()
  })

  it("status 返回任务+会话状态+尾部事件（不触发 resume）", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask({ agentSessionId: "task-AAAA1111", status: "doing" }))
    const before = await h.manager.status("TASK-2800")
    expect(before.session).toEqual({ sessionId: "task-AAAA1111", live: false, status: undefined })
    expect(h.agents.resume).not.toHaveBeenCalled()

    await h.manager.start("TASK-2800")
    const handle = (await h.agents.resume.mock.results[0].value) as AgentHandleLike
    const agent = handle.agent as ReturnType<typeof fakeAgent>
    agent.emit("agent/status", { status: "running" })
    agent.emit("session/event", { id: "task-AAAA1111" }, { seq: 1, type: "user/message", data: { text: "开始干活" } })
    const after = await h.manager.status("TASK-2800")
    expect(after.session.live).toBe(true)
    expect(after.session.status).toBe("running")
    expect(after.events).toEqual([
      { type: "status", status: "running" },
      { type: "user-message", text: "开始干活" },
    ])
  })

  it("审批监听按配置返回 allowed-once 或 rejected", async () => {
    const allow = makeHarness({ approval: "allow" })
    allow.tasks.set("TASK-2800", makeTask())
    await allow.manager.start("TASK-2800")
    const allowHandle = (await allow.agents.create.mock.results[0].value) as AgentHandleLike
    const allowAgent = allowHandle.agent as ReturnType<typeof fakeAgent>
    await expect(allowAgent.emit("approval/request", { toolName: "run_code" })).resolves.toBe("allowed-once")

    const deny = makeHarness({ approval: "never" })
    deny.tasks.set("TASK-2800", makeTask())
    await deny.manager.start("TASK-2800")
    const denyHandle = (await deny.agents.create.mock.results[0].value) as AgentHandleLike
    const denyAgent = denyHandle.agent as ReturnType<typeof fakeAgent>
    await expect(denyAgent.emit("approval/request", { toolName: "run_code" })).resolves.toBe("rejected")
  })

  it("createTaskSessionId 生成 task- 前缀 8 位 id", () => {
    const id = createTaskSessionId()
    expect(id).toMatch(/^task-[A-Z2-7]{8}$/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus-workflow test`
Expected: FAIL（`./manager.js` 不存在 / 类型错误）

- [ ] **Step 3: 实现 manager.ts**

```ts
import { randomInt } from "node:crypto"
import { createUserMessage } from "@deepseek-ai/dsh-llm"
import {
  appendEvent,
  createProjectState,
  projectEvents,
  tailEvents,
  type SessionEventLike,
} from "./sync.js"
import type {
  AgentCtxLike,
  ProjectStoreLike,
  RequirementStoreLike,
  TaskSessionEvent,
  TaskSessionStatus,
  TaskStoreLike,
} from "./types.js"
import { WorkflowError } from "./types.js"

const RANDOM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function createTaskSessionId(): string {
  let suffix = ""
  for (let i = 0; i < 8; i += 1) suffix += RANDOM_CHARS[randomInt(RANDOM_CHARS.length)]
  return `task-${suffix}`
}

export type ApprovalOutcomeLike = "allowed-once" | "rejected"

export interface AgentLike {
  id: string
  status: "idle" | "running"
  ctx: { on(event: string, listener: (...args: unknown[]) => unknown): unknown }
  followup(message: unknown): void
  cancel(cause: { kind: "user" }): void
}

export interface AgentHandleLike {
  agent: AgentLike
  dispose(): Promise<void>
}

export interface AgentsLike {
  create(options: {
    sessionId: string
    meta?: { cwd?: string; agentPreset?: string; taskId?: string }
    agentOptions?: { provider?: string; model?: string }
    setup?: (agentCtx: AgentCtxLike) => void | Promise<void>
  }): Promise<AgentHandleLike>
  resume(options: {
    resumeSessionId: string
    agentOptions?: { provider?: string; model?: string }
    setup?: (agentCtx: AgentCtxLike) => void | Promise<void>
  }): Promise<AgentHandleLike>
}

export interface ManagerDeps {
  agents: AgentsLike
  taskStore: TaskStoreLike
  requirementStore: RequirementStoreLike
  projectStore: ProjectStoreLike
  sessionIdFactory: () => string
  defaultCwd: string | null
  defaultAgentPreset: string
  provider?: string
  model?: string
  approval: "allow" | "never"
  buildTaskSetup: (taskId: string) => (agentCtx: AgentCtxLike) => void
}

interface Entry {
  taskId: string
  sessionId: string
  handle: AgentHandleLike
  events: TaskSessionEvent[]
  lastActivityMs: number
}

/** 任务子会话编排：创建/恢复/停止/追问/状态 + 事件环形缓冲 + 审批策略 */
export class TaskSessionManager {
  private entries = new Map<string, Entry>()
  private currentNow = (): number => Date.now()

  constructor(private deps: ManagerDeps) {}

  setNowSource(fn: () => number): void {
    this.currentNow = fn
  }

  private agentOptions(): { provider?: string; model?: string } {
    const options: { provider?: string; model?: string } = {}
    if (this.deps.provider !== undefined) options.provider = this.deps.provider
    if (this.deps.model !== undefined) options.model = this.deps.model
    return options
  }

  async start(taskId: string): Promise<{ sessionId: string; task: TaskRecord }> {
    const existing = this.entries.get(taskId)
    if (existing) {
      const task = this.deps.taskStore.get(taskId)
      if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
      return { sessionId: existing.sessionId, task }
    }
    const task = this.deps.taskStore.get(taskId)
    if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)

    const fresh = task.agentSessionId === undefined
    const sessionId = task.agentSessionId ?? this.deps.sessionIdFactory()
    let handle: AgentHandleLike
    if (fresh) {
      const cwd = this.resolveCwd(task)
      try {
        handle = await this.deps.agents.create({
          sessionId,
          meta: { cwd: cwd ?? undefined, agentPreset: this.deps.defaultAgentPreset, taskId },
          agentOptions: this.agentOptions(),
          setup: this.deps.buildTaskSetup(taskId),
        })
      } catch (error) {
        throw new WorkflowError(
          "session-unavailable",
          `task session create failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      await this.deps.taskStore.attachSession(taskId, sessionId)
    } else {
      handle = await this.resumeOrThrow(taskId, sessionId)
    }
    if (task.status === "todo") {
      await this.deps.taskStore.update(taskId, { status: "doing" })
    }
    const entry: Entry = { taskId, sessionId, handle, events: [], lastActivityMs: this.currentNow() }
    this.entries.set(taskId, entry)
    this.listenLive(taskId, entry, handle)
    if (fresh) this.kick(taskId, handle)
    const updated = this.deps.taskStore.get(taskId) ?? task
    return { sessionId, task: updated }
  }

  async stop(taskId: string): Promise<TaskRecord> {
    const task = this.deps.taskStore.get(taskId)
    if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
    const entry = this.entries.get(taskId)
    if (entry) {
      entry.handle.agent.cancel({ kind: "user" })
      await entry.handle.dispose().catch(() => {})
      this.entries.delete(taskId)
    }
    await this.deps.taskStore.attachSession(taskId, null)
    return this.deps.taskStore.reopen(taskId)
  }

  async send(taskId: string, message: string): Promise<void> {
    const task = this.deps.taskStore.get(taskId)
    if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
    if (!task.agentSessionId) {
      throw new WorkflowError("session-unavailable", `task ${taskId} has no agent session`)
    }
    const entry = this.entries.get(taskId) ?? await this.loadResumed(taskId, task.agentSessionId)
    entry.handle.agent.followup(createUserMessage({ content: [{ type: "text", text: message }], source: { kind: "user" } }))
    entry.lastActivityMs = this.currentNow()
  }

  async status(taskId: string): Promise<TaskSessionStatus> {
    const task = this.deps.taskStore.get(taskId)
    if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
    const entry = this.entries.get(taskId)
    return {
      task,
      session: {
        sessionId: task.agentSessionId ?? null,
        live: Boolean(entry?.handle),
        status: entry?.handle.agent.status,
      },
      events: entry ? tailEvents(entry.events) : [],
    }
  }

  async withdraw(): Promise<void> {
    for (const entry of [...this.entries.values()]) {
      await entry.handle.dispose().catch(() => {})
    }
    this.entries.clear()
  }

  private async resumeOrThrow(taskId: string, sessionId: string): Promise<AgentHandleLike> {
    try {
      return await this.deps.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: this.agentOptions(),
        // 恢复时重建作用域（get_task_context/report_task_status + restrict），与 spec「重启懒恢复重建作用域」一致
        setup: this.deps.buildTaskSetup(taskId),
      })
    } catch (error) {
      throw new WorkflowError(
        "session-unavailable",
        `task session resume failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async loadResumed(taskId: string, sessionId: string): Promise<Entry> {
    const handle = await this.resumeOrThrow(taskId, sessionId)
    const entry: Entry = { taskId, sessionId, handle, events: [], lastActivityMs: this.currentNow() }
    this.entries.set(taskId, entry)
    this.listenLive(taskId, entry, handle)
    return entry
  }

  private resolveCwd(task: TaskRecord): string | null {
    const project = this.deps.projectStore.get(task.projectId)
    return project?.workspacePath ?? this.deps.defaultCwd
  }

  private kick(taskId: string, handle: AgentHandleLike): void {
    const task = this.deps.taskStore.get(taskId)
    const requirement = task ? this.deps.requirementStore.get(task.requirementId) : undefined
    const project = task ? this.deps.projectStore.get(task.projectId) : undefined
    const lines: string[] = ["你是任务执行 agent。请完成以下任务："]
    if (task) lines.push(`任务：${task.title}`)
    if (task?.description) lines.push(`任务描述：${task.description}`)
    if (requirement) {
      lines.push(`所属需求：${requirement.title}（优先级 ${requirement.priority}）`)
      if (requirement.description) lines.push(`需求描述：${requirement.description}`)
    }
    lines.push(`工作目录：${project?.workspacePath ?? this.deps.defaultCwd ?? process.cwd()}`)
    lines.push("完成工作后，调用 report_task_status 工具提交评审（status: review），可附简短总结。")
    handle.agent.followup(createUserMessage({ content: [{ type: "text", text: lines.join("\n") }], source: { kind: "user" } }))
  }

  private listenLive(taskId: string, entry: Entry, handle: AgentHandleLike): void {
    const { agent } = handle
    const st = createProjectState()
    const push = (event: TaskSessionEvent): void => {
      entry.events = appendEvent(entry.events, event)
      entry.lastActivityMs = this.currentNow()
    }
    agent.ctx.on("session/event", (session, event) => {
      if ((session as { id?: string } | undefined)?.id !== entry.sessionId) return
      for (const captured of projectEvents(st, event as SessionEventLike)) push(captured)
    })
    agent.ctx.on("agent/status", (payload) => {
      const { status } = payload as { status: "idle" | "running" }
      push({ type: "status", status })
    })
    agent.ctx.on("agent/error", (payload) => {
      const error = (payload as { error?: unknown } | undefined)?.error
      push({ type: "error", message: error instanceof Error ? error.message : String(error ?? "agent error") })
    })
    agent.ctx.on("approval/request", () => {
      return Promise.resolve<ApprovalOutcomeLike>(this.deps.approval === "allow" ? "allowed-once" : "rejected")
    })
  }
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter octopus-workflow test`
Expected: PASS（若 `ProjectView`/`RequirementRecord` 类型导入报错，确认 Task 1-3 的 build 产物已生成）

- [ ] **Step 5: Commit**

```bash
git add packages/octopus-workflow/src/manager.ts packages/octopus-workflow/src/manager.test.ts
git commit -m "feat(octopus-workflow): task session manager with status sync and approval policy"
```

---

### Task 7: octopus-workflow — 主作用域 14 工具

**Files:**
- Create: `packages/octopus-workflow/src/schemas.ts`
- Create: `packages/octopus-workflow/src/tools.ts`
- Create: `packages/octopus-workflow/src/tools.test.ts`

**Interfaces:**
- Consumes: `RequirementStoreLike` / `TaskStoreLike` / `ProjectStoreLike` / `TaskSessionLike` / `WorkflowError`（types.ts）、`TaskSessionManager`（manager.ts，作为 `TaskSessionLike` 实参）
- Produces:
  - `export const MAIN_TOOL_NAMES: readonly string[]`（14 个名字，Task 8 的 restrict 名单与 Task 9 的注册循环使用）
  - `export function createMainTools(deps: { requirements; tasks; projects; sessions }): ToolDefinition[]`
  - `export function toolError(error: unknown): never`（`[code] message` 包装；Task 8 复用）

**工具清单与参数（14 个，命名/参数与 spec 一字不差）：**

| 工具 | 参数 | 行为 |
|---|---|---|
| `create_requirement` | `title`(req), `projectId`(req), `description?`, `priority?` enum P0/P1/P2 | project 校验存在 → `requirements.create({...source:"chat"})` |
| `list_requirements` | `projectId`(req), `status?`, `priority?` | `requirements.list(filter)` 按记录字段过滤 |
| `get_requirement` | `id`(req) | 不存在 → `[not-found]` |
| `update_requirement` | `id`(req), `title?`/`description?`/`priority?`/`status?` | `requirements.update` |
| `list_projects` | — | `projects.list()` 精简为 id/name/description/status/workspacePath |
| `get_project` | `id`(req) | 不存在 → `[not-found]` |
| `list_tasks` | `projectId`(req), `requirementId?`, `status?` | `tasks.list(filter)` |
| `get_task` | `id`(req) | 不存在 → `[not-found]` |
| `create_tasks` | `requirementId`(req), `projectId`(req), `tasks`(req, array of {title req, description?}, ≤50) | project 校验 → `tasks.createBatch` |
| `update_task` | `id`(req), `title?`/`description?`/`status?` enum 任务状态 | `tasks.update`（迁移非法 → `[invalid-transition]`） |
| `start_task_session` | `taskId`(req) | `sessions.start(taskId)` |
| `send_to_task_session` | `taskId`(req), `message`(req) | `sessions.send(taskId, message)` |
| `task_session_status` | `taskId`(req) | `sessions.status(taskId)` |
| `stop_task_session` | `taskId`(req) | `sessions.stop(taskId)` |

- [ ] **Step 1: 写失败测试（tools.test.ts）**

```ts
import { describe, expect, it, vi } from "vitest"
import { createMainTools, MAIN_TOOL_NAMES, toolError, type MainToolsDeps } from "./tools.js"
import type { ProjectStoreLike, TaskSessionLike, TaskStoreLike } from "./types.js"
import { WorkflowError } from "./types.js"
import type { RequirementRecord } from "octopus-requirements"
import type { TaskRecord } from "octopus-tasks"
import type { ProjectView } from "octopus-projects"

const makeRequirement = (): RequirementRecord => ({
  id: "REQ-100", title: "导出报表", description: "", priority: "P1",
  status: "planned", projectId: "prjA", source: "chat",
  createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
})

const makeTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "TASK-2800", title: "实现导出", description: "", requirementId: "REQ-100",
  projectId: "prjA", status: "todo",
  createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
  ...overrides,
})

const makeProject = (): ProjectView => ({
  id: "prjA", name: "Alpha", description: "", status: "active",
  workspacePath: "C:/projects/alpha", workspaceId: "ws-1", createdAt: "2026-08-26T00:00:00.000Z",
})

function makeHarness() {
  const requirements: MainToolsDeps["requirements"] = {
    get: vi.fn((id: string) => (id === "REQ-100" ? makeRequirement() : undefined)),
  }
  const tasks: TaskStoreLike = {
    get: vi.fn((id: string) => (id === "TASK-2800" ? makeTask() : undefined)),
    update: vi.fn(),
    attachSession: vi.fn(),
    setAgentSummary: vi.fn(),
    reopen: vi.fn(),
  }
  const projects: ProjectStoreLike = {
    get: vi.fn((id: string) => (id === "prjA" ? makeProject() : undefined)),
    list: vi.fn(() => [makeProject()]),
  }
  const sessions: TaskSessionLike = {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(),
    status: vi.fn(),
  }
  const tools = createMainTools({ requirements, tasks, projects, sessions })
  const byName = (name: string) => tools.find((t) => t.name === name)!
  return { requirements, tasks, projects, sessions, tools, byName }
}

const exec = (tool: { execute(args: unknown, exec: unknown): Promise<unknown> }, args: unknown) => tool.execute(args, {} as never)

describe("createMainTools", () => {
  it("注册 14 个工具且 MAIN_TOOL_NAMES 一致", () => {
    const { tools } = makeHarness()
    expect(MAIN_TOOL_NAMES).toHaveLength(14)
    expect(new Set(tools.map((t) => t.name))).toEqual(new Set(MAIN_TOOL_NAMES))
  })

  it("create_requirement：project 校验 + source=chat", async () => {
    const h = makeHarness()
    const create = vi.fn(async () => makeRequirement())
    h.requirements.create = create
    await expect(exec(h.byName("create_requirement"), { title: "x", projectId: "prjZ" }))
      .rejects.toThrow(/project-not-found/)
    await exec(h.byName("create_requirement"), { title: "新需求", projectId: "prjA", priority: "P0" })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "新需求", projectId: "prjA", priority: "P0", source: "chat" }))
  })

  it("list_requirements 按 projectId 过滤", async () => {
    const h = makeHarness()
    const record = makeRequirement()
    h.requirements.list = vi.fn((filter?: (r: RequirementRecord) => boolean) =>
      [record, { ...record, id: "REQ-101", projectId: "prjB" }].filter(filter ?? (() => true)))
    const result = await exec(h.byName("list_requirements"), { projectId: "prjA" }) as RequirementRecord[]
    expect(result.map((r) => r.id)).toEqual(["REQ-100"])
  })

  it("get_task 不存在抛 [not-found]", async () => {
    const h = makeHarness()
    await expect(exec(h.byName("get_task"), { id: "TASK-9999" })).rejects.toThrow(/not-found/)
  })

  it("create_tasks 校验 project 后委托 createBatch", async () => {
    const h = makeHarness()
    const batch = vi.fn(async () => [makeTask()])
    h.tasks.createBatch = batch
    await exec(h.byName("create_tasks"), {
      requirementId: "REQ-100", projectId: "prjA",
      tasks: [{ title: "实现导出" }, { title: "联调测试" }],
    })
    expect(batch).toHaveBeenCalledWith({ requirementId: "REQ-100", projectId: "prjA", tasks: [{ title: "实现导出" }, { title: "联调测试" }] })
  })

  it("update_task 透传非法迁移错误码", async () => {
    const h = makeHarness()
    h.tasks.update = vi.fn(async (): Promise<TaskRecord> => {
      throw new WorkflowError("invalid-input", "boom")
    })
    await expect(exec(h.byName("update_task"), { id: "TASK-2800", status: "done" })).rejects.toThrow(/\[invalid-input\] boom/)
  })

  it("start_task_session / stop / send / status 委托 sessions", async () => {
    const h = makeHarness()
    await exec(h.byName("start_task_session"), { taskId: "TASK-2800" })
    expect(h.sessions.start).toHaveBeenCalledWith("TASK-2800")
    await exec(h.byName("stop_task_session"), { taskId: "TASK-2800" })
    expect(h.sessions.stop).toHaveBeenCalledWith("TASK-2800")
    await exec(h.byName("send_to_task_session"), { taskId: "TASK-2800", message: "继续" })
    expect(h.sessions.send).toHaveBeenCalledWith("TASK-2800", "继续")
    await exec(h.byName("task_session_status"), { taskId: "TASK-2800" })
    expect(h.sessions.status).toHaveBeenCalledWith("TASK-2800")
  })

  it("toolError 包装错误码", () => {
    expect(() => toolError(new WorkflowError("session-unavailable", "no session"))).toThrow(/\[session-unavailable\] no session/)
    expect(() => toolError(new Error("plain"))).toThrow(/plain/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus-workflow test`
Expected: FAIL（`./schemas.js` / `./tools.js` 不存在）

- [ ] **Step 3: 实现 schemas.ts（JSON-schema 风格输出描述，供 tools/sub-tools 共用）**

```ts
/** 工具输出 JSON-schema 常量（defineTool output.schema 使用；参数 schema 在工具定义内联） */
export const requirementFields = {
  id: { type: "string", required: true },
  title: { type: "string", required: true },
  description: { type: "string", required: true },
  priority: { type: "string", required: true, enum: ["P0", "P1", "P2"] },
  status: { type: "string", required: true, enum: ["backlog", "planned", "in-progress", "review", "done"] },
  projectId: { type: "string", required: true },
  source: { type: "string", required: true, enum: ["manual", "chat"] },
  createdAt: { type: "string", required: true },
  updatedAt: { type: "string", required: true },
} as const

export const requirementObjectSchema = {
  type: "object", additionalProperties: false, properties: requirementFields,
} as const

export const requirementListSchema = {
  type: "array", items: requirementObjectSchema,
} as const

export const taskFields = {
  id: { type: "string", required: true },
  title: { type: "string", required: true },
  description: { type: "string", required: true },
  requirementId: { type: "string", required: true },
  projectId: { type: "string", required: true },
  status: { type: "string", required: true, enum: ["todo", "doing", "review", "done"] },
  agentSessionId: { type: "string" },
  agentSummary: { type: "string" },
  createdAt: { type: "string", required: true },
  updatedAt: { type: "string", required: true },
} as const

export const taskObjectSchema = {
  type: "object", additionalProperties: false, properties: taskFields,
} as const

export const taskListSchema = {
  type: "array", items: taskObjectSchema,
} as const

export const projectFields = {
  id: { type: "string", required: true },
  name: { type: "string", required: true },
  description: { type: "string", required: true },
  status: { type: "string", required: true, enum: ["active", "paused", "done", "archived"] },
  workspacePath: { type: "string", required: true },
  createdAt: { type: "string", required: true },
} as const

export const projectObjectSchema = {
  type: "object", additionalProperties: false, properties: projectFields,
} as const

export const projectListSchema = {
  type: "array", items: projectObjectSchema,
} as const
```

- [ ] **Step 4: 实现 tools.ts**

```ts
import { defineTool } from "@deepseek-ai/dsh-tools"
import {
  projectListSchema,
  projectObjectSchema,
  requirementListSchema,
  requirementObjectSchema,
  taskListSchema,
  taskObjectSchema,
} from "./schemas.js"
import type { ProjectStoreLike, RequirementStoreLike, TaskSessionLike, TaskStoreLike } from "./types.js"
import { WorkflowError } from "./types.js"

export const MAIN_TOOL_NAMES = [
  "create_requirement",
  "list_requirements",
  "get_requirement",
  "update_requirement",
  "list_projects",
  "get_project",
  "list_tasks",
  "get_task",
  "create_tasks",
  "update_task",
  "start_task_session",
  "send_to_task_session",
  "task_session_status",
  "stop_task_session",
] as const

/** 把带 code 的错误包装为模型可读的 `[code] message` 文本 */
export function toolError(error: unknown): never {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(code ? `[${code}] ${message}` : message)
}

export interface MainToolsDeps {
  requirements: RequirementStoreLike & {
    list?(filter?: (record: import("octopus-requirements").RequirementRecord) => boolean): import("octopus-requirements").RequirementRecord[]
    create?(input: { title: string; projectId: string; description?: string; priority?: "P0" | "P1" | "P2"; source: "chat" }): Promise<import("octopus-requirements").RequirementRecord>
    update?(id: string, patch: { title?: string; description?: string; priority?: "P0" | "P1" | "P2"; status?: string }): Promise<import("octopus-requirements").RequirementRecord>
  }
  tasks: TaskStoreLike & {
    list?(filter?: (record: import("octopus-tasks").TaskRecord) => boolean): import("octopus-tasks").TaskRecord[]
    createBatch?(input: { requirementId: string; projectId: string; tasks: { title: string; description?: string }[] }): Promise<import("octopus-tasks").TaskRecord[]>
  }
  projects: ProjectStoreLike
  sessions: TaskSessionLike
}

export function createMainTools(deps: MainToolsDeps) {
  const { requirements, tasks, projects, sessions } = deps
  const project = (id: string): void => {
    if (!projects.get(id)) throw new WorkflowError("project-not-found", `project ${id} not found`)
  }
  const text = (s: string) => [{ type: "text" as const, text: s }]

  return [
    defineTool({
      name: "create_requirement",
      description: "创建一条新需求。要求先通过 list_projects 确认 projectId。返回创建后的需求记录。",
      parameters: {
        title: { type: "string", required: true, description: "需求标题。" },
        projectId: { type: "string", required: true, description: "所属项目 id（list_projects 查询）。" },
        description: { type: "string", description: "需求描述。" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "优先级，缺省 P2。" },
      },
      output: {
        schema: requirementObjectSchema,
        render: (_args, value) => text(`created requirement ${value.id}: ${value.title}`),
      },
      async execute(args) {
        try {
          project(args.projectId)
          return await requirements.create!({
            title: args.title,
            projectId: args.projectId,
            description: args.description,
            priority: args.priority,
            source: "chat",
          })
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "list_requirements",
      description: "按项目查询需求列表，可按状态/优先级过滤。",
      parameters: {
        projectId: { type: "string", required: true, description: "项目 id。" },
        status: { type: "string", enum: ["backlog", "planned", "in-progress", "review", "done"], description: "状态过滤。" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "优先级过滤。" },
      },
      output: {
        schema: requirementListSchema,
        render: (_args, value) => text(`found ${value.length} requirements`),
      },
      async execute(args) {
        try {
          const items = requirements.list!((r) =>
            r.projectId === args.projectId
            && (args.status === undefined || r.status === args.status)
            && (args.priority === undefined || r.priority === args.priority),
          )
          return items
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "get_requirement",
      description: "按 id 查询单条需求。",
      parameters: { id: { type: "string", required: true, description: "需求 id，如 REQ-100。" } },
      output: {
        schema: requirementObjectSchema,
        render: (_args, value) => text(`requirement ${value.id}: ${value.title}`),
      },
      async execute(args) {
        try {
          const record = requirements.get(args.id)
          if (!record) throw new WorkflowError("not-found", `requirement ${args.id} not found`)
          return record
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "update_requirement",
      description: "更新需求（标题/描述/优先级/状态）。状态仅允许单向推进：backlog → planned → in-progress → review → done。",
      parameters: {
        id: { type: "string", required: true, description: "需求 id。" },
        title: { type: "string", description: "新标题。" },
        description: { type: "string", description: "新描述。" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "优先级。" },
        status: { type: "string", enum: ["backlog", "planned", "in-progress", "review", "done"], description: "新状态。" },
      },
      output: {
        schema: requirementObjectSchema,
        render: (_args, value) => text(`updated requirement ${value.id}: ${value.status}`),
      },
      async execute(args) {
        try {
          const patch: Record<string, unknown> = {}
          if (args.title !== undefined) patch.title = args.title
          if (args.description !== undefined) patch.description = args.description
          if (args.priority !== undefined) patch.priority = args.priority
          if (args.status !== undefined) patch.status = args.status
          return await requirements.update!(args.id, patch)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "list_projects",
      description: "列出全部项目（含工作区路径），用于发现 projectId。",
      parameters: {},
      output: {
        schema: projectListSchema,
        render: (_args, value) => text(`found ${value.length} projects`),
      },
      async execute() {
        try {
          return projects.list().map(({ id, name, description, status, workspacePath, createdAt }) =>
            ({ id, name, description, status, workspacePath, createdAt }))
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "get_project",
      description: "按 id 查询项目（含工作区路径）。",
      parameters: { id: { type: "string", required: true, description: "项目 id。" } },
      output: {
        schema: projectObjectSchema,
        render: (_args, value) => text(`project ${value.id}: ${value.name}`),
      },
      async execute(args) {
        try {
          const record = projects.get(args.id)
          if (!record) throw new WorkflowError("project-not-found", `project ${args.id} not found`)
          return { id: record.id, name: record.name, description: record.description, status: record.status, workspacePath: record.workspacePath, createdAt: record.createdAt }
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "list_tasks",
      description: "按项目查询任务列表，可按需求/状态过滤。",
      parameters: {
        projectId: { type: "string", required: true, description: "项目 id。" },
        requirementId: { type: "string", description: "需求 id 过滤。" },
        status: { type: "string", enum: ["todo", "doing", "review", "done"], description: "状态过滤。" },
      },
      output: {
        schema: taskListSchema,
        render: (_args, value) => text(`found ${value.length} tasks`),
      },
      async execute(args) {
        try {
          return tasks.list!((r) =>
            r.projectId === args.projectId
            && (args.requirementId === undefined || r.requirementId === args.requirementId)
            && (args.status === undefined || r.status === args.status),
          )
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "get_task",
      description: "按 id 查询单条任务（含 agentSessionId/agentSummary）。",
      parameters: { id: { type: "string", required: true, description: "任务 id，如 TASK-2800。" } },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`task ${value.id}: ${value.title} [${value.status}]`),
      },
      async execute(args) {
        try {
          const record = tasks.get(args.id)
          if (!record) throw new WorkflowError("not-found", `task ${args.id} not found`)
          return record
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "create_tasks",
      description: "按需求拆解结果批量保存任务（一次最多 50 条，全有或全无）。先 get_requirement 获取需求，再在对话内拆解为任务列表后调用本工具。",
      parameters: {
        requirementId: { type: "string", required: true, description: "所属需求 id。" },
        projectId: { type: "string", required: true, description: "项目 id（与需求一致）。" },
        tasks: {
          type: "array", required: true, description: "拆解出的任务列表。",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              title: { type: "string", required: true, description: "任务标题。" },
              description: { type: "string", description: "任务描述。" },
            },
          },
        },
      },
      output: {
        schema: taskListSchema,
        render: (_args, value) => text(`created ${value.length} tasks`),
      },
      async execute(args) {
        try {
          project(args.projectId)
          return await tasks.createBatch!({
            requirementId: args.requirementId,
            projectId: args.projectId,
            tasks: args.tasks,
          })
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "update_task",
      description: "更新任务（标题/描述/状态）。状态仅允许单向推进：todo → doing → review → done；review 由子 agent 或用户确认后置 done。",
      parameters: {
        id: { type: "string", required: true, description: "任务 id。" },
        title: { type: "string", description: "新标题。" },
        description: { type: "string", description: "新描述。" },
        status: { type: "string", enum: ["todo", "doing", "review", "done"], description: "新状态。" },
      },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`updated task ${value.id}: ${value.status}`),
      },
      async execute(args) {
        try {
          const patch: Record<string, unknown> = {}
          if (args.title !== undefined) patch.title = args.title
          if (args.description !== undefined) patch.description = args.description
          if (args.status !== undefined) patch.status = args.status
          return await tasks.update(args.id, patch)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "start_task_session",
      description: "为任务创建/恢复独立 agent 子会话并启动执行（任务自动置 doing）。已有会话时返回既有会话。",
      parameters: { taskId: { type: "string", required: true, description: "任务 id。" } },
      output: {
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            sessionId: { type: "string", required: true },
            task: taskObjectSchema,
          },
        },
        render: (_args, value) => text(`task session started: ${value.sessionId}`),
      },
      async execute(args) {
        try {
          return await sessions.start(args.taskId)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "send_to_task_session",
      description: "向任务子会话追加指令/追问（不创建新会话；会话会立即响应）。",
      parameters: {
        taskId: { type: "string", required: true, description: "任务 id。" },
        message: { type: "string", required: true, description: "要发送的消息。" },
      },
      output: {
        schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean", required: true } } },
        render: (_args, value) => text(value.ok ? "sent" : "failed"),
      },
      async execute(args) {
        try {
          await sessions.send(args.taskId, args.message)
          return { ok: true }
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "task_session_status",
      description: "查询任务执行情况：任务状态、会话 live/status、最近事件摘要（最后 15 条）与 agentSummary。用于跟踪进度与汇报。",
      parameters: { taskId: { type: "string", required: true, description: "任务 id。" } },
      output: {
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            task: taskObjectSchema,
            session: {
              type: "object", additionalProperties: false, required: true,
              properties: {
                sessionId: { type: "string" },
                live: { type: "boolean", required: true },
                status: { type: "string", enum: ["idle", "running"] },
              },
            },
            events: {
              type: "array",
              items: { type: "object", additionalProperties: false, properties: {
                type: { type: "string", required: true },
                text: { type: "string" },
                name: { type: "string" },
                status: { type: "string" },
                message: { type: "string" },
              } },
            },
          },
        },
        render: (_args, value) => text(`task ${value.task.id}: ${value.task.status}; session ${value.session.live ? value.session.status ?? "running" : "offline"}; ${value.events.length} recent events`),
      },
      async execute(args) {
        try {
          return await sessions.status(args.taskId)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "stop_task_session",
      description: "停止任务子会话：取消执行、解绑会话、任务回退到待处理（todo），之后可重新 start。",
      parameters: { taskId: { type: "string", required: true, description: "任务 id。" } },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`stopped task session for ${value.id}`),
      },
      async execute(args) {
        try {
          return await sessions.stop(args.taskId)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
  ]
}
```

> 注：`MainToolsDeps` 中 `requirements`/`tasks` 接口的 `list?/create?/update?/createBatch?` 可选成员是为了测试替身兼容；真实 `RequirementStore`/`TaskStore` 全部实现这些方法。`get_requirement`/`get_task` 的 not-found 用 `WorkflowError("not-found", ...)`——`toolError` 会提取 `code` 属性，直接产出 `[not-found]`。若 `projectStore.list()` 不存在（真实 `ProjectStoreLike` 有 list），`projects.list()` 在测试中用 `as never` 兼容。

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter octopus-workflow test`
Expected: PASS（类型以 `tsc --noEmit` 通过为准；必要时调整 `as never` 断言）

- [ ] **Step 6: Commit**

```bash
git add packages/octopus-workflow/src/schemas.ts packages/octopus-workflow/src/tools.ts packages/octopus-workflow/src/tools.test.ts
git commit -m "feat(octopus-workflow): 14 main-scope agent tools for requirements/tasks/sessions"
```

---

### Task 8: octopus-workflow — 子会话作用域工具 buildTaskSetup

**Files:**
- Create: `packages/octopus-workflow/src/sub-tools.ts`
- Create: `packages/octopus-workflow/src/sub-tools.test.ts`

**Interfaces:**
- Consumes: `taskObjectSchema`（schemas.ts）、`MAIN_TOOL_NAMES` / `toolError`（tools.ts）、`TaskStoreLike` / `RequirementStoreLike` / `WorkflowError`（types.ts）
- Produces:
  - `export interface AgentCtxLike { tools: { register(definition: unknown): unknown; restrict(filter: { allow?: string[]; deny?: string[] }): unknown } }`
  - `export function buildTaskSetup(deps: { taskStore: TaskStoreLike; requirementStore: RequirementStoreLike }, taskId: string): (agentCtx: AgentCtxLike) => void`
  - 注入工具：`get_task_context`（无参；返回 `{ task, requirement }`，requirement 不存在为 null）、`report_task_status`（`status` enum ["review","done"] 必填，`summary?`；先 `setAgentSummary` 再 `update({status})`）
  - setup 内调用 `agentCtx.tools.restrict({ deny: [...MAIN_TOOL_NAMES] })`

- [ ] **Step 1: 写失败测试（sub-tools.test.ts）**

```ts
import { describe, expect, it, vi } from "vitest"
import { buildTaskSetup, type AgentCtxLike } from "./sub-tools.js"
import { MAIN_TOOL_NAMES } from "./tools.js"
import type { RequirementStoreLike, TaskStoreLike } from "./types.js"
import type { RequirementRecord } from "octopus-requirements"
import type { TaskRecord } from "octopus-tasks"

const makeTask = (): TaskRecord => ({
  id: "TASK-2800", title: "实现导出", description: "支持 CSV", requirementId: "REQ-100",
  projectId: "prjA", status: "doing",
  createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
})

function makeHarness() {
  const taskStore: TaskStoreLike = {
    get: vi.fn(() => makeTask()),
    update: vi.fn(async (_id, patch) => ({ ...makeTask(), ...patch }) as TaskRecord),
    attachSession: vi.fn(),
    setAgentSummary: vi.fn(async (_id, summary) => ({ ...makeTask(), agentSummary: summary }) as TaskRecord),
    reopen: vi.fn(),
  }
  const requirementStore: RequirementStoreLike = {
    get: vi.fn(() => ({ id: "REQ-100", title: "导出报表", description: "", priority: "P1", status: "planned", projectId: "prjA", source: "chat", createdAt: "", updatedAt: "" }) as RequirementRecord),
  }
  const registered: { name: string; execute(args: unknown, exec: unknown): Promise<unknown> }[] = []
  let restrictFilter: { allow?: string[]; deny?: string[] } | null = null
  const agentCtx: AgentCtxLike = {
    tools: {
      register: (definition) => { registered.push(definition as never); return () => {} },
      restrict: (filter) => { restrictFilter = filter; return () => {} },
    },
  }
  buildTaskSetup({ taskStore, requirementStore }, "TASK-2800")(agentCtx)
  const byName = (name: string) => registered.find((t) => t.name === name)!
  return { taskStore, requirementStore, registered, restrictFilter, byName }
}

const exec = (tool: { execute(args: unknown, exec: unknown): Promise<unknown> }, args: unknown) => tool.execute(args, {} as never)

describe("buildTaskSetup", () => {
  it("注册 2 个作用域工具并 restrict 屏蔽全部主工具", () => {
    const h = makeHarness()
    expect(h.registered.map((t) => t.name)).toEqual(["get_task_context", "report_task_status"])
    expect(h.restrictFilter?.deny).toEqual([...MAIN_TOOL_NAMES])
  })

  it("get_task_context 返回任务与所属需求", async () => {
    const h = makeHarness()
    const result = await exec(h.byName("get_task_context"), {}) as { task: TaskRecord; requirement: RequirementRecord }
    expect(result.task.id).toBe("TASK-2800")
    expect(result.requirement.title).toBe("导出报表")
  })

  it("report_task_status 先写 summary 再推进状态", async () => {
    const h = makeHarness()
    const result = await exec(h.byName("report_task_status"), { status: "review", summary: " 已完成导出 " }) as TaskRecord
    expect(h.taskStore.setAgentSummary).toHaveBeenCalledWith("TASK-2800", "已完成导出")
    expect(h.taskStore.update).toHaveBeenCalledWith("TASK-2800", { status: "review" })
    expect(result.status).toBe("review")
  })

  it("report_task_status 无 summary 时不写总结", async () => {
    const h = makeHarness()
    await exec(h.byName("report_task_status"), { status: "done" })
    expect(h.taskStore.setAgentSummary).not.toHaveBeenCalled()
    expect(h.taskStore.update).toHaveBeenCalledWith("TASK-2800", { status: "done" })
  })

  it("任务不存在时工具抛 [task-not-found]", async () => {
    const h = makeHarness()
    h.taskStore.get = vi.fn(() => undefined)
    await expect(exec(h.byName("get_task_context"), {})).rejects.toThrow(/\[task-not-found\]/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus-workflow test`
Expected: FAIL（`./sub-tools.js` 不存在）

- [ ] **Step 3: 实现 sub-tools.ts**

```ts
import { defineTool } from "@deepseek-ai/dsh-tools"
import { taskObjectSchema } from "./schemas.js"
import { MAIN_TOOL_NAMES, toolError } from "./tools.js"
import type { AgentCtxLike, RequirementStoreLike, TaskStoreLike } from "./types.js"
import { WorkflowError } from "./types.js"

export type { AgentCtxLike } from "./types.js"

export interface SubToolsDeps {
  taskStore: TaskStoreLike
  requirementStore: RequirementStoreLike
}

const text = (s: string) => [{ type: "text" as const, text: s }]

/**
 * 任务子会话作用域装配：注入 get_task_context / report_task_status 两个工具，
 * 并屏蔽全部主作用域工具（防嵌套建会话/改他人数据）。
 */
export function buildTaskSetup(deps: SubToolsDeps, taskId: string): (agentCtx: AgentCtxLike) => void {
  const { taskStore, requirementStore } = deps
  return (agentCtx: AgentCtxLike): void => {
    agentCtx.tools.register(defineTool({
      name: "get_task_context",
      description: "读取本任务及其所属需求（标题/描述/优先级）。开工前先调用。",
      parameters: {},
      output: {
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            task: taskObjectSchema,
            requirement: {
              type: "object", additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                title: { type: "string", required: true },
                description: { type: "string", required: true },
                priority: { type: "string", required: true, enum: ["P0", "P1", "P2"] },
              },
            },
          },
        },
        render: (_args, value) => text(`task ${value.task.id}: ${value.task.title}`),
      },
      async execute() {
        try {
          const task = taskStore.get(taskId)
          if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
          const requirement = requirementStore.get(task.requirementId)
          return { task, requirement: requirement ?? null }
        } catch (error) {
          throw toolError(error)
        }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: "report_task_status",
      description: "上报本任务进度。工作完成后调用 status=review 提交评审（可附简短总结）；review 被确认后再调用 status=done 收尾。",
      parameters: {
        status: {
          type: "string", required: true, enum: ["review", "done"],
          description: "review：完成并提交评审；done：终态（须先 review）。",
        },
        summary: { type: "string", description: "完成情况简述（写入任务记录 agentSummary）。" },
      },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`task ${value.id} → ${value.status}`),
      },
      async execute(args) {
        try {
          const task = taskStore.get(taskId)
          if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
          if (args.summary !== undefined) {
            await taskStore.setAgentSummary(taskId, args.summary)
          }
          return await taskStore.update(taskId, { status: args.status })
        } catch (error) {
          throw toolError(error)
        }
      },
    }))
    agentCtx.tools.restrict({ deny: [...MAIN_TOOL_NAMES] })
  }
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter octopus-workflow test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/octopus-workflow/src/sub-tools.ts packages/octopus-workflow/src/sub-tools.test.ts
git commit -m "feat(octopus-workflow): task-scoped sub-session tools with restrict mask"
```

---

### Task 9: octopus-workflow — index.ts 接线 + 根脚本 + README

**Files:**
- Create: `packages/octopus-workflow/src/index.ts`
- Create: `packages/octopus-workflow/README.md`
- Modify: `package.json`（根 dev/dev:noopen 脚本）
- Modify: `README.md`（根：功能表/结构/挂载顺序）

**Interfaces:**
- Consumes: `TaskSessionManager`（manager.ts）、`createMainTools` / `MAIN_TOOL_NAMES`（tools.ts）、`buildTaskSetup`（sub-tools.ts）、`ctx.get("tools" | "agents" | "requirementStore" | "taskStore" | "projectStore")`（Task 1-3 的 ctx 增强 + dsh 平台服务）
- Produces: 插件 `octopus-workflow`（name/inject/Config/apply；无 web 模块）

- [ ] **Step 1: 写插件接线测试（index.test.ts）**

接线断言核心：apply 后 `ctx.tools.register` 被调用 14 次（工具名与 MAIN_TOOL_NAMES 一致），且每个工具定义存在；依赖缺失时注册仍成功但 execute 抛错（降级语义）。

```ts
import { describe, expect, it, vi } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import plugin from "./index.js"
import { MAIN_TOOL_NAMES } from "./tools.js"

function makeCtx() {
  const registered: { name: string }[] = []
  const ctx = new Context()
  ctx.provide("tools", {
    register: (definition: { name: string }) => { registered.push(definition); return () => {} },
  } as never)
  ctx.provide("agents", { create: vi.fn(), resume: vi.fn() } as never)
  ctx.provide("requirementStore", { get: () => undefined } as never)
  ctx.provide("taskStore", {
    get: () => undefined, update: vi.fn(), attachSession: vi.fn(), setAgentSummary: vi.fn(), reopen: vi.fn(),
  } as never)
  ctx.provide("projectStore", { get: () => undefined, list: () => [] } as never)
  return { ctx, registered }
}

describe("octopus-workflow index", () => {
  it("apply 注册 14 个主工具且名字与 MAIN_TOOL_NAMES 一致", async () => {
    const { ctx, registered } = makeCtx()
    await ctx.plugin(plugin as never)
    expect(registered.map((t) => t.name)).toEqual([...MAIN_TOOL_NAMES])
    expect(registered).toHaveLength(14)
  })

  it("store 缺失时 start_task_session 工具报 task-not-found", async () => {
    const { ctx, registered } = makeCtx()
    await ctx.plugin(plugin as never)
    const start = registered.find((t) => t.name === "start_task_session") as unknown as
      { execute(args: { taskId: string }, exec: unknown): Promise<unknown> }
    await expect(start.execute({ taskId: "TASK-9999" }, {} as never)).rejects.toThrow(/task-not-found/)
  })
})
```

> 说明：第二个用例中 manager 的 `taskStore.get` 返回 undefined → `task-not-found`（真实 store 缺失时 get 为 undefined 桩，与真实行为一致——真实环境中 store 服务由 octopus-tasks provide，get 正常返回）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus-workflow test`
Expected: FAIL（`./index.js` 不存在）

- [ ] **Step 3: 实现 index.ts**

```ts
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { TaskSessionManager, createTaskSessionId, type AgentsLike } from "./manager.js"
import { createMainTools } from "./tools.js"
import { buildTaskSetup } from "./sub-tools.js"

export const name = "octopus-workflow"
export const inject = ["agents", "tools", "requirementStore", "taskStore", "projectStore"]

export const Config = z.object({
  defaultCwd: z.string().required(false),
  defaultAgentPreset: z.string().default("standard"),
  /** 子会话审批策略：allow=自动放行（默认，无头执行）；never=确定性拒绝（只读审计模式） */
  subSessionApproval: z.union(["allow", "never"]).default("allow"),
  provider: z.string().required(false),
  model: z.string().required(false),
})

type WorkflowConfig = ReturnType<typeof Config>

interface ToolsLike {
  register(definition: unknown): () => void
}

/** 编排插件：主 agent 工具（需求/任务/项目/会话编排）+ 任务子会话管理 */
export async function apply(ctx: Context, config: Partial<WorkflowConfig> = {}) {
  // ctx.get 返回平台 AgentRegistry/真实 store；结构兼容断言到本地接口
  const agents = ctx.get("agents") as unknown as AgentsLike
  const tools = ctx.get("tools") as ToolsLike
  const requirementStore = ctx.get("requirementStore")
  const taskStore = ctx.get("taskStore")
  const projectStore = ctx.get("projectStore")

  const manager = new TaskSessionManager({
    agents,
    taskStore,
    requirementStore,
    projectStore,
    sessionIdFactory: createTaskSessionId,
    defaultCwd: config.defaultCwd ?? null,
    defaultAgentPreset: config.defaultAgentPreset ?? "standard",
    provider: config.provider,
    model: config.model,
    approval: config.subSessionApproval ?? "allow",
    buildTaskSetup: (taskId) => buildTaskSetup({ taskStore, requirementStore }, taskId),
  })

  ctx.effect(() => {
    const disposers = createMainTools({
      requirements: requirementStore,
      tasks: taskStore,
      projects: projectStore,
      sessions: manager,
    }).map((definition) => tools.register(definition))
    return () => {
      for (const dispose of disposers) dispose()
      void manager.withdraw()
    }
  })
}

export default { name, inject, Config, apply }
```

- [ ] **Step 4: 运行测试与构建**

Run: `pnpm --filter octopus-workflow test`
Expected: PASS
Run: `pnpm --filter octopus-workflow build`
Expected: 构建成功

- [ ] **Step 5: 根 package.json 追加挂载**

根 `package.json` 的 `dev` 与 `dev:noopen` 两个脚本中，`./packages/octopus-agent` 之后追加 ` ./packages/octopus-workflow`（两个脚本都改）。

- [ ] **Step 6: 根 README 更新**

- 功能表新增一行：`| 🤖↔📋 Agent 编排 | 主 agent 工具（需求/任务 CRUD）+ 每任务独立子会话执行与跟踪 | octopus-workflow |`
- 「结构」小节追加：`- packages/octopus-workflow：Agent 编排服务插件：主会话 14 个工具（需求/项目/任务/会话编排）+ 任务子会话（真实 AgentLoop、作用域工具、事件跟踪），依赖三域 store 服务`
- 目录结构总览树追加 `├── octopus-workflow/         # Agent 编排服务插件`（放在 octopus-tasks 之后）
- 挂载顺序句追加 `→ octopus-workflow`（`... → octopus-tasks → octopus-agent → octopus-workflow`）
- 新增小节「Agent 工作流（octopus-workflow）」：

```markdown
## Agent 工作流（octopus-workflow）

主 agent 会话（工作台聊天）可直接操作需求/任务/项目域，并为任务拉起独立子会话执行：

1. **创建需求**：聊天中让 agent 调用 `create_requirement`（项目 id 用 `list_projects` 查询）
2. **拆解任务**：agent 读取需求（`get_requirement`）后在对话内拆解，经 `create_tasks` 批量保存
3. **子会话执行**：`start_task_session` 为任务创建真实 AgentLoop 子会话（工作目录=项目工作区），任务自动置「进行中」；子 agent 完成后经 `report_task_status` 提交评审
4. **跟踪**：`task_session_status` 查询任务状态与最近事件摘要；`send_to_task_session` 追问；`stop_task_session` 停止并回退待处理

任务子会话为真实 dsh 会话，可在聊天面板会话列表打开观看；任务卡显示 agent 会话徽章与完成摘要。

> 子会话审批默认自动放行（`octopus-workflow.subSessionApproval: "allow"`）；需要审计时可设 `"never"`（所有需审批的工具调用将被确定性拒绝）。主会话审批仍走聊天内审批按钮。
```

- [ ] **Step 7: Commit**

```bash
git add packages/octopus-workflow/src/index.ts packages/octopus-workflow/src/index.test.ts packages/octopus-workflow/README.md package.json README.md
git commit -m "feat(octopus-workflow): plugin wiring, mount scripts and docs"
```

---

### Task 10: octopus-tasks web — 任务卡会话徽章与摘要

**Files:**
- Modify: `packages/octopus-tasks/web/src/types.ts`
- Modify: `packages/octopus-tasks/web/src/components/TaskBoard.tsx`
- Test: `packages/octopus-tasks/web/src/index.test.tsx`

**Interfaces:**
- Consumes: web `TaskRecord`（本任务扩展）、`TaskBoard` 现有卡片渲染
- Produces: 卡片「agent 会话」徽章（`aria-label="agent session"`，title=会话 id）与 `agentSummary` 摘要行

- [ ] **Step 1: 扩展 web 类型与卡片**

`web/src/types.ts` 的 `TaskRecord` 增加：

```ts
  agentSessionId?: string
  agentSummary?: string
```

`web/src/components/TaskBoard.tsx` 卡片头（`<span className="mono ...">{t.id}</span>` 之后）插入徽章：

```tsx
              {t.agentSessionId && (
                <span
                  aria-label="agent session"
                  title={`任务会话 ${t.agentSessionId}`}
                  className="rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground"
                >
                  agent
                </span>
              )}
```

标题行之后插入摘要（仅当存在）：

```tsx
            {t.agentSummary && (
              <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{t.agentSummary}</div>
            )}
```

- [ ] **Step 2: 写失败测试（index.test.tsx 追加用例）**

在 `TASKS` 常量中给 `TASK-2801` 增加 `agentSessionId: "task-AAAA1111"`，新增一条带摘要的卡：

```ts
const TASKS = [
  { id: "TASK-2800", title: "导出 CSV", description: "", requirementId: "REQ-100", projectId: "p-alpha", status: "todo", createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
  { id: "TASK-2801", title: "联调测试", description: "", requirementId: "REQ-100", projectId: "p-alpha", status: "doing", agentSessionId: "task-AAAA1111", agentSummary: "已完成联调", createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
  { id: "TASK-2802", title: "验收上线", description: "", requirementId: "REQ-100", projectId: "p-alpha", status: "done", createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
]
```

新增用例：

```ts
  it("任务卡显示 agent 会话徽章与完成摘要", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { ok: true, data: TASKS })))
    render(<TasksModule />)
    await screen.findByText("导出 CSV")
    expect(screen.getByLabelText("agent session")).toBeInTheDocument()
    expect(screen.getByText("已完成联调")).toBeInTheDocument()
    const badge = screen.getByLabelText("agent session")
    expect(badge.closest("[draggable]")?.textContent).toContain("TASK-2801")
  })
```

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter octopus-tasks test`
Expected: PASS（src 单测 + web 单测）

- [ ] **Step 4: Commit**

```bash
git add packages/octopus-tasks/web/src/types.ts packages/octopus-tasks/web/src/components/TaskBoard.tsx packages/octopus-tasks/web/src/index.test.tsx
git commit -m "feat(octopus-tasks): task card agent session badge and summary"
```

---

### Task 11: 全量验收

**Files:** 无新增（验证 + 必要修正）

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS（octopus / octopus-ui / octopus-users / octopus-auth / octopus-users-view / octopus-quickstart / octopus-projects / octopus-requirements / octopus-tasks / octopus-agent / octopus-workflow）

- [ ] **Step 2: 全量构建**

Run: `pnpm build`
Expected: 全部构建成功（注意 workflow 依赖三个包的类型产物，构建顺序由 pnpm topo 保证）

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter octopus-workflow typecheck`
Expected: 无错误

- [ ] **Step 4: 手工流程验收（需 DEEPSEEK_API_KEY 环境，`pnpm dev` 后浏览器操作）**

1. `/workbench` 打开聊天，工具模式为 code（README「⚠️ 工具模式必设」）
2. 对话：`列出项目` → agent 调 `list_projects`
3. `在 <项目名> 中创建需求：<标题>，优先级 P0` → `create_requirement`
4. `查询需求` → `list_requirements`
5. `把 <REQ-id> 拆解为任务并保存` → agent 对话内拆解 → `create_tasks`
6. `为 <TASK-id> 启动任务会话并跟踪` → `start_task_session`（任务卡状态变 doing，聊天面板会话列表出现 `task-*` 会话）→ 等待若干秒 → `task_session_status` 汇报事件摘要
7. `停止 <TASK-id> 的任务会话` → `stop_task_session`，看板任务回 todo
8. 聊天面板打开 `task-*` 会话可看到子 agent 完整执行流（可监督）
9. 任务看板模块：进行中卡片显示 agent 徽章；完成的任务（子 agent 提交 review 后）显示摘要

- [ ] **Step 5: 失败即修复并重跑对应单测，通过后提交修正**

```bash
git add -A
git commit -m "test: octopus-workflow acceptance fixes"
```

---

## Self-Review 记录（写完后执行）

- **Spec 覆盖**：14 主工具（T7）✓；2 子工具 + restrict（T8）✓；1:1 关联 `agentSessionId` + `agentSummary`（T1/T10）✓；混合状态推进（T6 start→doing / report→review / stop→todo 经 reopen）✓；事件跟踪环形缓冲（T5/T6）✓；审批 allow/never（T6/T9 Config）✓；重启懒恢复（T6 send/start 的 resume 路径）✓；store 服务 provide（T1/T2/T3）✓；UI 徽章（T10）✓；根脚本/README（T9）✓。
- **Placeholder 扫描**：所有步骤含完整代码与测试；无 TBD/TODO。
- **类型一致性**：`attachSession(id, string | null)` 在 T1 定义、T6/T7 使用一致；`reopen` T1/T6 一致；`MAIN_TOOL_NAMES` 14 项 T7 定义、T8/T9 引用；`toolError` T7 定义、T8 引用；`createMainTools` deps 形状 T7 定义、T9 传参一致；`TaskSessionEvent` T4 定义、T5 投影产出、T6 缓冲、T7 status 输出一致。
