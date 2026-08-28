# octopus-agent 工作台 Agent 会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `packages/octopus-agent` 服务端插件（dsh AgentLoop 真实会话 + REST/SSE API + 持久化重放），壳前端把 `AgentClient` 从 mock 升级为「HTTP 客户端（插件在位）/ mock（插件缺失）」双实现，工作台聊天变为真实 agent 对话。

**Architecture:** 纯服务插件无前端 bundle：`webServer.register` 挂 `/api/octopus-agent` 路由；AgentManager 用 `ctx.agents.create/resume` 驱动 AgentLoop 会话，agent-scope 会话事件经纯投影（`project.ts`）写入每会话 `EventIndex`（单调 idx），`GET /history` 与 `GET /events?after=`（SSE）共用同一索引；审批经 agent-scope `approval/request` 挂桥（SSE `approval` 事件 + 答案端点）。壳前端保留既有 `AgentClient` 选择缝并升级为事件驱动；`createDefaultAgentClient()` 先探测 `/api/octopus-agent/up`，失败回退 mock（失败隔离）。

**Tech Stack:** TypeScript、Cordis 插件（`@deepseek-ai/cordis`）、vitest、node:http（webServer）、React 18（壳 web）、octopus-ui（DropdownMenu）。

**Spec:** `docs/superpowers/specs/2026-08-28-octopus-agent-design.md`

## Global Constraints

- **插件红线**（承自仓库惯例）：`ctx.webServer.register({ kind, path, handler(req, res) })`；错误统一 `{ error }` JSON + 状态码；API 请求/响应适配层与 octopus-projects 同构（仿 `packages/octopus-projects/src/api.ts` 的 `ApiError`/`readJsonBody`/`sendJson` 模式）
- **无 web/ 目录**：octopus-agent 是纯服务插件，不注册 workbench 模块；壳经 `/up` 探测
- React 只能命名导入 `"react"`、`"react-dom"`、`"react/jsx-runtime"`（README vendor 改写约束）；样式全走 Tailwind 工具类与语义 token，禁止裸色值/arbitrary 颜色类/裸 z-index（设计系统红线）
- 新增 `MessageBlock` kind 只允许 `approval`，且为**受控扩展**：`{ kind: "approval"; approvalId: string; toolName: string; reason?: string }`（`web/src/lib/types.ts`）
- UI 文案与既有中文一致（「会话」「新建会话」「正在思考…」「回答 Agent 的问题…」）
- id 规则：sessionId = `oct-` + 8 位随机大写字母（A-Z0-9 排除易混淆）；approval/question id = `${sessionId}:a`/`${sessionId}:q` 单调序号
- type-only 依赖 dsh 包（`@deepseek-ai/dsh-agent` 等）只 import type，运行依赖走 dsh 安装闭包 flat fallback，不加入 dependencies
- 测试命令（仓库根目录 PowerShell）：
  - `pnpm --filter octopus-agent test` / `pnpm --filter octopus-agent build`
  - `pnpm --filter octopus exec vitest run --root web`
  - `pnpm --filter octopus exec tsc -p web/tsconfig.json --noEmit`
- 提交信息用约定式前缀（`feat:`/`refactor:`/`test:`/`chore:`），每个任务至少一次提交

## File Structure

```
packages/octopus-agent/               # ★ 新建：服务端插件（无 web/）
├── package.json                      # deps: schemastery；peerDeps: @deepseek-ai/cordis；devDeps: dsh 类型包
├── tsconfig.json / tsconfig.build.json / vitest.config.ts
├── cordis.patch.yml                  # insert { id: octopus-agent, name: octopus-agent }
├── README.md
└── src/
    ├── index.ts                      # 插件入口：inject 守卫 + 路由注册 + 配置
    ├── index.test.ts
    ├── types.ts                      # 线上协议 AgentStreamEvent / SessionMeta / 请求体
    ├── project.ts                    # 纯投影：SessionEventLike → AgentStreamEvent（callId 名称关联）
    ├── project.test.ts
    ├── events-index.ts               # EventIndex：单调 idx + 历史重建 + 切片
    ├── events-index.test.ts
    ├── manager.ts                    # AgentManager：create/resume/dispose/status/审批桥/idle-ttl
    ├── manager.test.ts
    ├── api.ts                        # HTTP handler（Node req/res），含 SSE 输出
    └── api.test.ts
packages/octopus/web/src/
    ├── lib/types.ts                  # MODIFY：AgentStreamEvent/SessionMeta + MessageBlock approval kind
    ├── lib/agent-client.ts           # REWRITE：事件驱动 AgentClient + 脚本 mock 适配 + createHttpAgentClient + 探测
    ├── lib/agent-client.test.ts      # REWRITE
    ├── lib/use-chat.ts               # REWRITE：流式事件 → 消息/思考/审批状态/产出
    ├── lib/use-chat.test.tsx         # REWRITE
    ├── components/ChatMessage.tsx    # MODIFY：approval 块渲染（允许/拒绝按钮）
    ├── components/ChatMessage.test.tsx
    ├── components/ChatPane.tsx       # MODIFY：会话切换 dropdown + 审批回调上行
    ├── components/ChatPane.test.tsx
    ├── App.tsx                       # MODIFY：project workspacePath → startSession cwd；产出派生
    └── App.test.tsx
package.json                          # MODIFY：dev/dev:noopen 追加 ./packages/octopus-agent
README.md                             # MODIFY：插件清单 + agent 能力说明
```

---

### Task 1: octopus-agent 包脚手架

**Files:**
- Create: `packages/octopus-agent/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`cordis.patch.yml`、`README.md`、`src/types.ts`、`src/index.ts`（最小 apply）、`src/index.test.ts`
- Modify: `package.json`（根，dev 脚本追加包）、`README.md`（插件清单）

**Interfaces:**
- Produces:
  - 包名 `octopus-agent`，插件 `name = "octopus-agent"`，`inject = ["webServer"]`，`Config` 骨架
  - `src/types.ts` 导出（后续任务消费）：
    ```ts
    export type AgentPresetLike = string
    export interface SessionMeta { id: string; createdAt: string; cwd: string | null; title: string | null; live: boolean }
    export type AgentStreamEvent = { idx: number } & (
      | { type: "status"; status: "idle" | "running" }
      | { type: "user-message"; text: string }
      | { type: "assistant-text"; text: string }
      | { type: "tool-call"; callId: string; name: string; summary: string }
      | { type: "tool-result"; callId: string; ok: boolean; preview: string }
      | { type: "turn"; at: "start" | "end"; reason?: string }
      | { type: "question"; id: string; question: string; options?: string[] }
      | { type: "approval"; id: string; toolName: string; reason?: string }
      | { type: "error"; message: string }
    )
    export interface CreateSessionInput {
      cwd?: string
      agentPreset?: string
      provider?: string
      model?: string
    }
    ```

- [ ] **Step 1: scaffold 文件**

package.json：

```json
{
  "name": "octopus-agent",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "exports": { ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" } },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "scripts": { "build": "tsc -p tsconfig.build.json", "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@deepseek-ai/schemastery": "^3.18.1" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-agent": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-session": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-llm": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-user-approval": "^0.1.1-rc.2",
    "tsc-alias": "^1.8.10",
    "typescript": "^5.6.0",
    "vitest": "^4.1.8"
  }
}
```

> tsc-alias 仅在构建产物需要 `.js` 后缀重写时使用；若 octopus 包已有统一做法请照抄（查看 `packages/octopus/package.json` 的 build 脚本），不一致时以 octopus 包为准。

tsconfig.json（参考 `packages/octopus/tsconfig.json`）：

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "types": ["node"], "declaration": true, "sourceMap": true
  },
  "include": ["src"]
}
```

tsconfig.build.json：`{ "extends": "./tsconfig.json", "compilerOptions": { "outDir": "lib", "types": ["node"] }, "include": ["src"], "exclude": ["**/*.test.ts"] }`

vitest.config.ts：`{ test: { include: ["src/**/*.test.ts"] } }`（加 `"vite": { ... }` 不需要额外配置）。

cordis.patch.yml：

```yaml
- insert:
    - id: octopus-agent
      name: octopus-agent
```

src/types.ts：按 Interfaces 原样落地。

src/index.ts：

```ts
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"

export const name = "octopus-agent"
export const inject = ["webServer"]

export const Config = z.object({
  defaultCwd: z.string().optional(),
  defaultAgentPreset: z.string().default("standard"),
  provider: z.string().optional(),
  model: z.string().optional(),
  idleTtlMs: z.number().default(30 * 60 * 1000),
})

export function apply(ctx: Context, config: Partial<typeof Config> = {}) {
  void ctx
  void config
}
```

src/index.test.ts：

```ts
import { describe, expect, it } from "vitest"
import { Config, inject, name } from "./index"

describe("octopus-agent plugin", () => {
  it("declares plugin identity and webServer inject", () => {
    expect(name).toBe("octopus-agent")
    expect(inject).toEqual(["webServer"])
  })
  it("config has defaults", () => {
    const cfg = Config()
    expect(cfg.defaultAgentPreset).toBe("standard")
    expect(cfg.idleTtlMs).toBe(30 * 60 * 1000)
  })
})
```

根 package.json 脚本（两个脚本)追加：

```
... ./packages/octopus-tasks ./packages/octopus-agent --config.auto-install-peers=false
```

README.md 更新：结构清单加 `packages/octopus-agent` 一行（「工作台 Agent 会话服务：dsh AgentLoop 真实会话 + /api/octopus-agent；未挂载时聊天回退脚本 mock」）。

- [ ] **Step 2: 安装与自检**

Run: `pnpm install ; pnpm --filter octopus-agent test`
Expected: PASS ×2

- [ ] **Step 3: Commit** — `feat(octopus-agent): scaffold service plugin package`

---

### Task 2: 会话事件纯投影 project.ts

**Files:**
- Create: `packages/octopus-agent/src/project.ts`、`project.test.ts`

**Interfaces:**
- Consumes: `SessionEvent`（dsh-session 类型，仅 type import）
- Produces:
  ```ts
  export interface SessionEventLike {
    seq: number
    time: number
    type: string
    data: Record<string, unknown>
  }
  export interface ProjectState { callNames: Map<string, string> }
  export function createProjectState(): ProjectState
  export function projectEvent(state: ProjectState, ev: SessionEventLike): CapturedEvent | null
  export interface CapturedEvent {
    sourceSeq: number
    type: "user-message" | "assistant-text" | "tool-call" | "tool-result" | "turn-start" | "turn-end" | "approval"
    payload: Record<string, unknown>
  }
  export function toStreamEvent(ev: CapturedEvent): Omit<AgentStreamEvent, "idx">
  export function deriveTitle(events: CapturedEvent[]): string | null
  ```
  - 投影规则：
    - `user/message` data.text（或 data.content[0].text）→ `user-message`
    - `assistant/message`：data.message.content 逐块——`text` → `assistant-text`（多块多条）；`tool-call` → `tool-call`（记录 `callNames.set(callId, name)`，summary=参数 JSON 截断 160 字符）
    - `tool/result`：经 `state.callNames.get(data.message.content[0].toolCallId)` 取名；ok = !data.error；preview = 内容文本 JSON 截断 200 字符；找不到 colldId → name "tool"
    - `turn/start`/`turn/end`（reason 透传）→ `turn-start`/`turn-end`
    - `approval/asked` → `approval`（id/toolName/reason）
    - 其余 → null
  - `deriveTitle`：取第一个 user-message 文本前 30 字符（含省略号「…」）或 null

- [ ] **Step 1: 写失败测试 project.test.ts**

```ts
import { describe, expect, it } from "vitest"
import { createProjectState, projectEvent, toStreamEvent, deriveTitle, type SessionEventLike } from "./project"

function ev(seq: number, type: string, data: Record<string, unknown>): SessionEventLike {
  return { seq, time: 1000, type, data }
}

describe("projectEvent", () => {
  it("projects user message and assistant text", () => {
    const st = createProjectState()
    const user = projectEvent(st, ev(0, "user/message", { text: "hi" }))
    expect(user && toStreamEvent(user)).toMatchObject({ type: "user-message", text: "hi" })
    const asst = projectEvent(st, ev(1, "assistant/message", {
      message: { content: [{ type: "text", text: "hello" }, { type: "tool-call", id: "c1", name: "run_pwsh", arguments: "{}" }] },
      turn: 1, step: 1,
    }))
    expect(asst && toStreamEvent(asst)).toMatchObject({ type: "assistant-text", text: "hello" })
    const tool = projectEvent(st, ev(2, "assistant/message", {
      message: { content: [{ type: "tool-call", id: "c1", name: "run_pwsh", arguments: "{}" }] },
      turn: 1, step: 1,
    }))
    const tev = tool && toStreamEvent(tool)
    expect(tev).toMatchObject({ type: "tool-call", callId: "c1", name: "run_pwsh" })
  })
  it("projects tool result with resolved name", () => {
    const st = createProjectState()
    projectEvent(st, ev(0, "assistant/message", { message: { content: [{ type: "tool-call", id: "c1", name: "str_replace_editor", arguments: "{}" }] }, turn: 1, step: 1 }))
    const r = projectEvent(st, ev(1, "tool/result", { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "ok done" }] }] }, error: undefined }))
    const v = r && toStreamEvent(r)
    expect(v).toMatchObject({ type: "tool-result", callId: "c1", name: "str_replace_editor", ok: true })
    expect((v as { preview: string }).preview).toContain("ok done")
  })
  it("projects turn boundaries and approval audit", () => {
    const st = createProjectState()
    const t = projectEvent(st, ev(0, "turn/start", { turn: 1 }))
    expect(t && toStreamEvent(t)).toMatchObject({ type: "turn", at: "start" })
    const a = projectEvent(st, ev(1, "approval/asked", { id: "a1", toolName: "fs_write", reason: "write outside workspace?" }))
    expect(a && toStreamEvent(a)).toMatchObject({ type: "approval", id: "a1", toolName: "fs_write" })
  })
  it("ignores chunk and unknown events", () => {
    const st = createProjectState()
    expect(projectEvent(st, ev(0, "assistant/chunk", { chunk: {} }))).toBe(null)
    expect(projectEvent(st, ev(1, "weird/event", { x: 1 }))).toBe(null)
  })
  it("derives title from first user text and null when absent", () => {
    const st = createProjectState()
    const evs = [
      projectEvent(st, ev(0, "user/message", { text: "给我列出所有待办任务并汇总到周报文档" }))!,
      projectEvent(st, ev(1, "assistant/message", { message: { content: [{ type: "text", text: "好" }] }, turn: 1, step: 1 }))!,
    ]
    expect(deriveTitle(evs)).toContain("给我列出所有待办任务")
    expect(deriveTitle([])).toBe(null)
  })
})
```

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter octopus-agent test` → FAIL（无 project.ts）

- [ ] **Step 3: 实现 project.ts**

```ts
import type { AgentStreamEvent } from "./types"

export interface SessionEventLike {
  seq: number
  time: number
  type: string
  data: Record<string, unknown>
}

export interface ProjectState { callNames: Map<string, string> }
export function createProjectState(): ProjectState { return { callNames: new Map() } }

export interface CapturedEvent {
  sourceSeq: number
  type: "user-message" | "assistant-text" | "tool-call" | "tool-result" | "turn-start" | "turn-end" | "approval"
  payload: Record<string, unknown>
}

const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)

function textBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content.filter((b: unknown): b is { type: "text"; text: string } =>
    typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string",
  ).map((b) => b.text)
}

function blockSummary(block: { arguments?: unknown }): string {
  const raw = typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments ?? {})
  return clamp(raw, 160)
}

function projectMessage(st: ProjectState, data: Record<string, unknown>): CapturedEvent[] {
  const message = data.message as { content?: unknown[] } | undefined
  const content = message?.content ?? []
  const out: CapturedEvent[] = []
  if (!Array.isArray(content)) return out
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue
    const b = block as { type?: unknown }
    if (b.type === "text" && typeof (block as { text?: unknown }).text === "string") {
      out.push({ sourceSeq: (data._seq as number) ?? 0, type: "assistant-text", payload: { text: (block as { text: string }).text } })
    } else if (b.type === "tool-call") {
      const call = block as { id?: unknown; name?: unknown; arguments?: unknown }
      const id = String(call.id ?? "")
      const name = String(call.name ?? "tool")
      st.callNames.set(id, name)
      out.push({ sourceSeq: (data._seq as number) ?? 0, type: "tool-call", payload: { callId: id, name, summary: blockSummary(call) } })
    }
  }
  return out
}

export function projectEvent(st: ProjectState, ev: SessionEventLike): CapturedEvent | null {
  const d = ev.data
  switch (ev.type) {
    case "user/message": {
      const text = typeof d.text === "string" ? d.text : ""
      return { sourceSeq: ev.seq, type: "user-message", payload: { text } }
    }
    case "turn/start": return { sourceSeq: ev.seq, type: "turn-start", payload: {} }
    case "turn/end": return { sourceSeq: ev.seq, type: "turn-end", payload: d.reason !== undefined ? { reason: String(d.reason) } : {} }
    case "approval/asked": {
      return {
        sourceSeq: ev.seq,
        type: "approval",
        payload: {
          id: String(d.id ?? "unknown"),
          toolName: String(d.toolName ?? "tool"),
          reason: typeof d.reason === "string" ? d.reason : undefined,
        },
      }
    }
    case "assistant/message": {
      const msgs = projectMessage(st, { ...d, _seq: ev.seq })
      return msgs.length === 1 ? msgs[0] : null
    }
    case "tool/result": {
      const content = (d.message as { content?: unknown[] } | undefined)?.content
      const first = Array.isArray(content) ? content[0] : undefined
      const block = first && typeof first === "object" ? first as { toolCallId?: unknown; content?: unknown[] } : undefined
      const callId = String(block?.toolCallId ?? "")
      const preview = clamp(JSON.stringify(block?.content ?? []), 200)
      return {
        sourceSeq: ev.seq,
        type: "tool-result",
        payload: { callId, name: st.callNames.get(callId) ?? "tool", ok: d.error === undefined, preview },
      }
    }
    default: return null
  }
}

export function toStreamEvent(ev: CapturedEvent): Omit<AgentStreamEvent, "idx"> {
  switch (ev.type) {
    case "user-message": return { type: "user-message", text: ev.payload.text as string }
    case "assistant-text": return { type: "assistant-text", text: ev.payload.text as string }
    case "tool-call": return { type: "tool-call", callId: ev.payload.callId as string, name: ev.payload.name as string, summary: ev.payload.summary as string }
    case "tool-result": return { type: "tool-result", callId: ev.payload.callId as string, name: ev.payload.name as string, ok: ev.payload.ok as boolean, preview: ev.payload.preview as string }
    case "turn-start": return { type: "turn", at: "start" }
    case "turn-end": return { type: "turn", at: "end", reason: ev.payload.reason as string | undefined }
    case "approval": return { type: "approval", id: ev.payload.id as string, toolName: ev.payload.toolName as string, reason: ev.payload.reason as string | undefined }
  }
}

export function deriveTitle(events: CapturedEvent[]): string | null {
  const first = events.find((e) => e.type === "user-message")
  if (!first) return null
  const text = (first.payload.text as string).trim().replace(/\s+/g, " ")
  return text.length === 0 ? null : clamp(text, 30)
}
```

- [ ] **Step 4: 测试转绿** — Run: `pnpm --filter octopus-agent test` → PASS ×5

- [ ] **Step 5: Commit** — `feat(octopus-agent): session event projection`

---

### Task 3: EventIndex 事件索引

**Files:**
- Create: `packages/octopus-agent/src/events-index.ts`、`events-index.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class EventIndex {
    list(startIdx?: number): AgentStreamEvent[]      // 单调 idx，start 为半开下限
    append(event: Omit<AgentStreamEvent, "idx">): number            // 返回 idx
    appendAll(events: Omit<AgentStreamEvent, "idx">[]): number      // 重建历史（清空后装载）
    get lastIdx(): number                                           // -1 when empty
    get size(): number
  }
  ```
  行为：append 恒递增；appendAll 只允许在索引为空时调用（否则抛 Error）；list(-1|0) 全量。

- [ ] **Step 1: 写失败测试 events-index.test.ts**

```ts
import { describe, expect, it } from "vitest"
import { EventIndex } from "./events-index"

describe("EventIndex", () => {
  it("appends with monotonic idx", () => {
    const idx = new EventIndex()
    expect(idx.lastIdx).toBe(-1)
    expect(idx.append({ type: "status", status: "running" })).toBe(0)
    expect(idx.append({ type: "user-message", text: "hi" })).toBe(1)
    expect(idx.list()).toHaveLength(2)
    expect(idx.list(1)).toEqual([{ idx: 1, type: "user-message", text: "hi" }])
  })
  it("rebuild only when empty and continues ids", () => {
    const idx = new EventIndex()
    idx.appendAll([
      { type: "user-message", text: "a" },
      { type: "assistant-text", text: "b" },
    ])
    expect(idx.lastIdx).toBe(1)
    expect(idx.list()).toHaveLength(2)
    expect(() => idx.appendAll([{ type: "status", status: "idle" }])).toThrow()
    expect(idx.append({ type: "turn", at: "end" })).toBe(2)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 events-index.ts**

```ts
import type { AgentStreamEvent } from "./types"

export class EventIndex {
  private events: AgentStreamEvent[] = []
  private started = false

  append(event: Omit<AgentStreamEvent, "idx">): number {
    const idx = this.events.length
    this.events.push({ ...event, idx } as AgentStreamEvent)
    return idx
  }

  appendAll(events: Omit<AgentStreamEvent, "idx">[]): number {
    if (this.started && this.events.length > 0) throw new Error("EventIndex: appendAll requires an empty index")
    this.started = true
    for (const event of events) this.append(event)
    return this.lastIdx
  }

  list(startIdx = 0): AgentStreamEvent[] {
    if (startIdx < 0 || startIdx > this.events.length) return []
    return this.events.slice(startIdx)
  }

  get lastIdx(): number { return this.events.length - 1 }
}
```

> 注：SSE 重连去重由客户端按 `idx > lastIdx` 决定；`list(startIdx)` 半开边界保证与 `after=` 参数一致。

- [ ] **Step 4: 测试转绿** → PASS ×2

- [ ] **Step 5: Commit** — `feat(octopus-agent): monotonic event index with rebuild`

---

### Task 4: AgentManager

**Files:**
- Create: `packages/octopus-agent/src/manager.ts`、`manager.test.ts`

**Interfaces:**
- Consumes: `project.ts`、`events-index.ts`、`types.ts`
- Produces:
  ```ts
  export interface UserMessageLike {
    role: "user"
    content: { type: "text"; text: string }[]
    source: { kind: "user" }
  }
  export interface AgentLike {
    id: string
    status: "idle" | "running"
    ctx: { on(event: string, listener: (...args: unknown[]) => void): unknown }
    followup(message: UserMessageLike): void
    cancel(cause: string): void
  }
  export interface AgentHandleLike { agent: AgentLike; dispose(): Promise<void> }
  export interface AgentsLike {
    create(options: {
      sessionId: string
      meta?: { cwd?: string; agentPreset?: string }
      agentOptions?: { provider?: string; model?: string }
    }): Promise<AgentHandleLike>
    resume(options: { resumeSessionId: string; agentOptions?: { provider?: string; model?: string } }): Promise<AgentHandleLike>
  }
  export interface PersistenceLike {
    load(id: string): Promise<{ meta: { cwd: unknown; createdAt: unknown }; events: unknown[] }>
    listSnapshots(): Promise<{ header: { id: string; createdAt: unknown; meta?: { cwd?: unknown } } }[]>
  }
  export interface ApprovalLike { id: string; toolName: string; reason?: string }
  export interface ManagerDeps {
    agents: AgentsLike
    persistence: PersistenceLike
    sessionIdFactory: () => string                      // "oct-" + 8 位大写字母
    defaultCwd: string | null
    defaultAgentPreset: string
    provider?: string
    model?: string
    idleTtlMs: number
    systemPromptSection?: (agentRaw: AgentRawApi, text: string) => void
  }
  export class AgentManager {
    constructor(deps: ManagerDeps)
    create(input: { cwd?: string; agentPreset?: string; provider?: string; model?: string }): Promise<SessionMeta>
    resume(id: string): Promise<SessionMeta>
    list(): Promise<SessionMeta[]>
    getStatus(id: string): { live: boolean; status?: "idle" | "running"; pendingApprovalId?: string }
    getIndex(id: string, opts?: { allowResume?: boolean }): Promise<EventIndex>
    send(id: string, text: string): Promise<void>
    cancel(id: string): Promise<void>
    dispose(id: string): Promise<void>
    answerApproval(id: string, approvalId: string, decision: "allow" | "deny"): Promise<void>
    withdraw(): Promise<void>
  }
  ```
  - create：mint id → `deps.agents.create({ sessionId: id, meta: { cwd: input.cwd ?? deps.defaultCwd (未提供则不设), agentPreset }, agentOptions: { provider, model } 过滤 undefined })`；成功后在 `handle.agent.ctx.on("session/event", …)` 投影入 index（live 条目）；`agent.ctx.on("agent/status", …)` → index "status"；`agent.ctx.on("approval/request", …)` → SSE 桥（pending ApprovalLike，resolve 时回调）；错误信息（`agent/error`?）可选 `agent.ctx.on("agent/error")` → index "error"（message 文本）；记录 dispose 到 entry。会话首次发送前如果 `index.size === 0` 且会话来自 resume → 不自动装载（由 api 层负责 load）
  - resume：创建后不立即装载索引——调用 `ensureLoaded(id)`：优先从持久化 `persistence.load(id)` 的 events 建 CapturedEvent 列表（用 `projectEvent` 逐条 + stub state），再 appendAll；live broker 监听在新 handle 上注册
  - 该种语义与 API 层一致：`getIndex(id, { allowResume })`；未 live 且 allowResume → resume（幂等，若已 live 返回现有）
  - `answerApproval`：查找 entry 中匹配 approvalId 的 pending resolver；匹配 → 以 decision 为 outcome 调用回调（allow→"allow"，deny→"deny"）；不匹配 → throw `new ManagerError("APPROVAL_NOT_FOUND", 404)`
  - idle ttl：dispose 后 `setTimeout` 清理…… 由于 Entry 持有 handle 引用，ttl 检查放 `dispose()` 与 `list()`：每个 entry 记录 `lastActivityMs`；`list()` 时若 `lastActivityMs + idleTtlMs < now` 且无 SSE 订阅 → 异步 dispose 后过滤。测试用可注入 `now()`。

```ts
export class ManagerError extends Error {
  constructor(readonly code: "SESSION_EXISTS" | "SESSION_NOT_FOUND" | "APPROVAL_NOT_FOUND" | "AGENT_LOOP_UNAVAILABLE", message: string) {
    super(message)
  }
}
```

- [ ] **Step 1: 写失败测试 manager.test.ts**（fake agents/persistence）

```ts
import { describe, expect, it, vi } from "vitest"
import { AgentManager, ManagerError, type AgentHandleLike, type AgentLike, type PersistenceLike } from "./manager"

function fakeAgent(id: string, events: { on: (t: string, cb: (...a: unknown[]) => void) => void; status: "idle" | "running" }): AgentLike {
  const listeners: Record<string, (...a: unknown[]) => void> = {}
  return {
    id,
    get status() { return events.status },
    ctx: { on: (t, cb) => { listeners[t] = cb; return 0 } },
    followup: vi.fn(),
    cancel: vi.fn(),
  } as never
}

function makeManager(opts: { persistLoad?: PersistenceLike["load"] } = {}) {
  const created: { sessionId: string; options: unknown }[] = []
  const agents = {
    create: vi.fn(async (options: { sessionId: string; meta?: Record<string, unknown> }) => {
      created.push({ sessionId: options.sessionId, options })
      return { agent: fakeAgent(options.sessionId, { on: () => { }, status: "idle" }), dispose: vi.fn(async () => {}) } as AgentHandleLike
    }),
    resume: vi.fn(async (options: { resumeSessionId: string }) => {
      return { agent: fakeAgent(options.resumeSessionId, { on: () => { }, status: "idle" }), dispose: vi.fn(async () => {}) } as AgentHandleLike
    }),
  }
  const persistence: PersistenceLike = {
    load: opts.persistLoad ?? vi.fn(async () => ({ meta: { cwd: "/p", createdAt: 1 }, events: [] })),
    listSnapshots: vi.fn(async () => []),
  }
  let seq = 0
  const manager = new AgentManager({
    agents,
    persistence,
    sessionIdFactory: () => `oct-${String(++seq).padStart(8, "A")}`,
    defaultCwd: null,
    defaultAgentPreset: "standard",
    idleTtlMs: 0,
  })
  return { manager, agents, persistence }
}

describe("AgentManager", () => {
  it("creates a session with cwd preset and agentOptions", async () => {
    const { manager, agents } = makeManager()
    const meta = await manager.create({ cwd: "/project/open", agentPreset: "standard", provider: "deepseek-official", model: "deepseek-v4-flash" })
    expect(meta.id).toMatch(/^oct-/)
    expect(meta.cwd).toBe("/project/open")
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ cwd: "/project/open", agentPreset: "standard" }),
      agentOptions: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    }))
  })
  it("sends a followup message", async () => {
    const { manager } = makeManager()
    const meta = await manager.create({})
    // 注：manager.send 需要能取到 live agent 的 followup
    await expect(manager.send(meta.id, "你好")).resolves.toBeUndefined()
  })
  it("loads history from persistence via ensureLoaded / getIndex", async () => {
    const { manager, persistence } = makeManager()
    persistence.load = vi.fn(async (id: string) => ({
      meta: { cwd: "/x", createdAt: 1 },
      events: [
        { seq: 0, time: 1, type: "user/message", data: { text: "hi" } } as never,
        { seq: 1, time: 2, type: "assistant/message", data: { message: { content: [{ type: "text", text: "yo" }] } } } as never,
      ],
    }))
    await manager.create({})
    // 无 live 会话 → allowResume 触发 persistence 装载 + resume
    const idx = await manager.getIndex("oct-AAAAAAA1", { allowResume: true })
    const evs = idx.list()
    expect(evs).toHaveLength(2)
    expect(evs[0]).toMatchObject({ type: "user-message", text: "hi" })
  })
  it("throws SESSION_EXISTS on duplicate id and SESSION_NOT_FOUND on unknown", async () => {
    const { manager } = makeManager()
    await manager.create({})
    await expect(manager.create({})).resolves.toBeDefined() // 每次 id 不同
    await expect(manager.send("oct-UNKNOWN", "x")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
  })
  it("answers pending approval and errors on unknown id", async () => {
    const { manager } = makeManager()
    const meta = await manager.create({})
    // 直接注入 pending（不走 dsh 事件系统）：manager 内部 expose 测试钩子
    ;(manager as unknown as { setPendingApprovalForTest(id: string, approvalId: string): void }).setPendingApprovalForTest(meta.id, "oct-AAAAAAA1:a1")
    await manager.answerApproval(meta.id, "oct-AAAAAAA1:a1", "allow")
    // since the fake approval hook resolves – just assert no throw
    await expect(manager.answerApproval(meta.id, "oct-AAAAAAA1:a2", "allow")).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" })
  })
})
```

> 说明：`setPendingApprovalForTest` 为 manager 上 `approval/request` listener 的直调替代（listener 注册在 fake ctx 上，事件由测试手动触发）。实现里 listener 的数据结构为 `pendingApprovals: Map<approvalId, { resolve: (outcome: "allow" | "deny") => void }>`，测试触发 `agentCTX.emit` 不现实时改为直接调用 manager 内部方法 `settlePendingApprovalForTest`。

- [ ] **Step 2: 运行确认失败** → FAIL（manager 不存在）

- [ ] **Step 3: 实现 manager.ts**

```ts
import { EventIndex } from "./events-index"
import { createProjectState, projectEvent, toStreamEvent, type CapturedEvent, type SessionEventLike } from "./project"
import type { AgentStreamEvent, SessionMeta } from "./types"

export interface UserMessageLike {
  role: "user"
  content: { type: "text"; text: string }[]
  source: { kind: "user" }
}

export interface AgentOps {
  id: string
  status: "idle" | "running"
  ctx: {
    on(event: string, listener: (...args: unknown[]) => void): unknown
    emit?(event: string, ...args: unknown[]): void
  }
  followup(message: UserMessageLike): void
  cancel(cause: string): void
}

export interface AgentHandleLike { agent: AgentOps; dispose(): Promise<void> }

export interface AgentsLike {
  create(options: { sessionId: string; meta?: { cwd?: string; agentPreset?: string; parentSession?: string }; agentOptions?: { provider?: string; model?: string } }): Promise<AgentHandleLike>
  resume(options: { resumeSessionId: string; agentOptions?: { provider?: string; model?: string } }): Promise<AgentHandleLike>
}

export interface PersistenceLike {
  load(id: string): Promise<{ meta: { cwd?: unknown; createdAt?: unknown }; events: unknown[] }>
  listSnapshots(): Promise<{ header: { id: string; createdAt?: unknown; meta?: { cwd?: unknown } } }[]>
}

export interface ApprovalLike { id: string; toolName: string; reason?: string }
export type ApprovalDecision = "allow" | "deny"

export class ManagerError extends Error {
  constructor(readonly code: "SESSION_EXISTS" | "SESSION_NOT_FOUND" | "APPROVAL_NOT_FOUND" | "AGENT_LOOP_UNAVAILABLE", message: string) {
    super(message)
  }
}

interface SessionEntry {
  meta: SessionMeta
  handle: AgentHandleLike | null
  index: EventIndex
  pendingApprovals: Map<string, { approval: ApprovalLike; resolve: (d: ApprovalDecision) => void }>
  lastActivityMs: number
}

export interface ManagerDeps {
  agents: AgentsLike
  persistence: PersistenceLike
  sessionIdFactory: () => string
  defaultCwd: string | null
  defaultAgentPreset: string
  provider?: string
  model?: string
  idleTtlMs: number
}

interface ManagedEvent {
  sessionId: string
  project(ev: SessionEventLike): CapturedEvent[] | null
  raw: SessionEventLike
}

export class AgentManager {
  private entries = new Map<string, SessionEntry>()
  private currentNow: () => number

  constructor(private deps: ManagerDeps) {
    this.currentNow = () => Date.now()
  }

  setNowSource(fn: () => number): void { this.currentNow = fn }

  private metaOf(id: string, createdAt: string, cwd: string | null): SessionMeta {
    return { id, createdAt, cwd, title: null, live: false }
  }

  private guardLive(id: string): SessionEntry {
    const entry = this.entries.get(id)
    if (!entry) throw new ManagerError("SESSION_NOT_FOUND", `session ${id} not found`)
    return entry
  }

  private listenLive(entry: SessionEntry, handle: AgentHandleLike): void {
    const { agent } = handle
    const st = createProjectState()
    entry.handle = handle
    entry.meta = { ...entry.meta, live: true }
    const pushStream = (ev: Omit<AgentStreamEvent, "idx">) => {
      entry.index.append(ev)
      entry.lastActivityMs = this.currentNow()
    }
    agent.ctx.on("session/event", (_: unknown, session: { id: string }, event: unknown) => {
      if (session.id !== entry.meta.id) return
      const typed = event as SessionEventLike
      const captured = projectEvent(st, typed)
      if (!captured) return
      pushStream(toStreamEvent(captured))
      if (captured.type === "user-message") entry.meta.title = entry.meta.title ?? deriveTitleFrom(entry, captured)
    })
    agent.ctx.on("agent/status", (_: unknown, payload: { status: "idle" | "running" }) => {
      pushStream({ type: "status", status: payload.status })
      entry.lastActivityMs = this.currentNow()
    })
    agent.ctx.on("approval/request", (_: unknown, req: { toolName?: string; reason?: string }, next: () => Promise<unknown>) => {
      const id = `${entry.meta.id}:a${entry.approvalSeq++}`
      const approval: ApprovalLike = { id, toolName: req.toolName ?? "tool", reason: req.reason }
      pushStream({ type: "approval", ...approval })
      return new Promise<void>((resolve) => {
        entry.pendingApprovals.set(id, {
          approval,
          resolve: (decision) => {
            entry.pendingApprovals.delete(id)
            void next().then(() => resolve())
          },
        })
      })
    })
    agent.ctx.on("agent/error", (_: unknown, payload: { error?: unknown }) => {
      const message = payload.error instanceof Error ? payload.error.message : String(payload.error ?? "agent error")
      pushStream({ type: "error", message })
    })
  }

  setPendingApprovalForTest(sessionId: string, approvalId: string): void {
    const entry = this.guardLive(sessionId)
    entry.pendingApprovals.set(approvalId, { approval: { id: approvalId, toolName: "tool" }, resolve: () => {} })
  }

  approvalSeqBy = new Map<string, number>()

  async create(input: { cwd?: string; agentPreset?: string; provider?: string; model?: string } = {}): Promise<SessionMeta> {
    const id = this.deps.sessionIdFactory()
    if (this.entries.has(id)) throw new ManagerError("SESSION_EXISTS", `session ${id} exists`)
    const meta: { cwd?: string; agentPreset?: string } = {}
    if (input.cwd || this.deps.defaultCwd) meta.cwd = input.cwd ?? this.deps.defaultCwd!
    meta.agentPreset = input.agentPreset ?? this.deps.defaultAgentPreset
    const agentOptions = { provider: input.provider ?? this.deps.provider, model: input.model ?? this.deps.model }
    let handle: AgentHandleLike
    try {
      handle = await this.deps.agents.create({ sessionId: id, meta, agentOptions })
    } catch (error) {
      throw new ManagerError("AGENT_LOOP_UNAVAILABLE", `agent create failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    const entry: SessionEntry = {
      meta: this.metaOf(id, new Date().toISOString(), meta.cwd ?? null),
      handle: null,
      index: new EventIndex(),
      pendingApprovals: new Map(),
      lastActivityMs: this.currentNow(),
    }
    this.approvalSeqBy.set(id, 0)
    this.entries.set(id, entry)
    this.listenLive(entry, handle)
    return entry.meta
  }

  async ensureLoaded(id: string, preferResume = true): Promise<SessionEntry> {
    const existing = this.entries.get(id)
    if (existing && existing.handle) return existing
    if (!preferResume) throw new ManagerError("SESSION_NOT_FOUND", `session ${id} not live`)
    let handle: AgentHandleLike
    try {
      handle = await this.deps.agents.resume({ resumeSessionId: id, agentOptions: {} })
    } catch (error) {
      throw new ManagerError("AGENT_LOOP_UNAVAILABLE", `resume failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    const history = await this.deps.persistence.load(id)
    const st = createProjectState()
    const captured: CapturedEvent[] = []
    for (const raw of history.events) captured.push(await projectFromRaw(st, raw as SessionEventLike))
    const trimmed = captured.filter((c): c is CapturedEvent => c !== null)
    const entry: SessionEntry = {
      meta: this.metaOf(id, String(history.meta.createdAt ?? ""), typeof history.meta.cwd === "string" ? history.meta.cwd : null),
      handle,
      index: new EventIndex(),
      pendingApprovals: new Map(),
      lastActivityMs: this.currentNow(),
    }
    this.approvalSeqBy.set(id, 0)
    const streamEvents = trimmed.map(toStreamEvent)
    entry.index.appendAll(streamEvents)
    entry.meta.title = deriveTitle(trimmed)
    this.entries.set(id, entry)
    this.listenLive(entry, handle)
    return entry
  }

  async getIndex(id: string, opts: { allowResume?: boolean } = {}): Promise<EventIndex> {
    if (opts.allowResume && !this.entries.get(id)?.handle) {
      await this.ensureLoaded(id, true)
    }
    const entry = this.entries.get(id)
    if (!entry) throw new ManagerError("SESSION_NOT_FOUND", `session ${id} not found`)
    return entry.index
  }

  async list(): Promise<SessionMeta[]> {
    for (const [id, entry] of this.entries) {
      if (this.deps.idleTtlMs > 0 && entry.handle && entry.index.size === 0 && idsMatch(entry, id) && underTtl(entry, this.deps.idleTtlMs, this.currentNow())) {
        // ttl 过期且无事件 → 回收
        await entry.handle.dispose().catch(() => {})
        this.entries.delete(id)
      }
    }
    const metas = [...this.entries.values()].map((e) => e.meta)
    const snapshots = await this.deps.persistence.listSnapshots()
    const ids = new Set(metas.map((m) => m.id))
    for (const s of snapshots) {
      if (ids.has(s.header.id)) continue
      metas.push({
        id: s.header.id,
        createdAt: typeof s.header.createdAt === "string" ? s.header.createdAt : new Date(String(s.header.createdAt ?? "")).toISOString(),
        cwd: typeof s.header.meta?.cwd === "string" ? s.header.meta.cwd : null,
        title: null,
        live: false,
      })
    }
    return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  getStatus(id: string): { live: boolean; status?: "idle" | "running"; pendingApprovalId?: string } {
    const entry = this.entries.get(id)
    if (!entry?.handle) return { live: false }
    const pending = entry.pendingApprovals.values().next().value
    return { live: true, status: entry.handle.agent.status, pendingApprovalId: pending?.approval.id }
  }

  async send(id: string, text: string): Promise<void> {
    const entry = this.ensureLiveEntry(id)
    entry.lastActivityMs = this.currentNow()
    entry.handle!.agent.followup({ role: "user", content: [{ type: "text", text }], source: { kind: "user" } })
  }

  private ensureLiveEntry(id: string): SessionEntry {
    const entry = this.entries.get(id)
    if (!entry?.handle) throw new ManagerError("SESSION_NOT_FOUND", `session ${id} not live`)
    return entry
  }

  async cancel(id: string): Promise<void> {
    const entry = this.ensureLiveEntry(id)
    entry.handle!.agent.cancel("user")
  }

  async dispose(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) throw new ManagerError("SESSION_NOT_FOUND", `session ${id} not found`)
    if (entry.handle) await entry.handle.dispose().catch(() => {})
    this.entries.delete(id)
    this.approvalSeqBy.delete(id)
  }

  async answerApproval(id: string, approvalId: string, decision: "allow" | "deny"): Promise<void> {
    const entry = this.entries.get(id)
    const pending = entry?.pendingApprovals.get(approvalId)
    if (!pending) throw new ManagerError("APPROVAL_NOT_FOUND", `approval ${approvalId} not pending`)
    pending.resolve(decision)
  }

  async withdraw(): Promise<void> {
    for (const entry of this.entries.values()) {
      await entry.handle?.dispose().catch(() => {})
    }
    this.entries.clear()
  }
}

function deriveTitleFrom(entry: SessionEntry, captured: CapturedEvent): string {
  return String(captured.payload.text).slice(0, 30)
}

async function projectFromRaw(st: ReturnType<typeof createProjectState>, ev: SessionEventLike): Promise<CapturedEvent | null> {
  return projectEvent(st, ev)
}

function deriveTitle(events: CapturedEvent[]): string | null {
  const first = events.find((e) => e.type === "user-message")
  if (!first) return null
  return String(first.payload.text).trim().replace(/\s+/g, " ").slice(0, 30) || null
}

function idsMatch(entry: SessionEntry, id: string): boolean { return entry.meta.id === id }
function underTtl(entry: SessionEntry, ttlMs: number, now: number): boolean {
  return now - entry.lastActivityMs > ttlMs
}
```

> 注：`approvalSeqBy`/`setPendingApprovalForTest` 为测试钩子；`approval listener` 的 `next()` waterfall 细节（ApprovalOutcome 由 `resolve` 的 callback 参数回传）被简化为仅 `await next().then(resolve)`——真实 Outcome 注入在 Task 6 通过 `approvalDecisionBridge` 完成，本任务保持接口形状。

- [ ] **Step 4: 测试转绿** — Run: `pnpm --filter octopus-agent test` → PASS ×5

- [ ] **Step 5: Commit** — `feat(octopus-agent): agent session manager with history resume`

---

### Task 5: HTTP API handler（含 SSE）

**Files:**
- Create: `packages/octopus-agent/src/api.ts`、`api.test.ts`

**Interfaces:**
- Consumes: `AgentManager`、`EventIndex`、`AgentStreamEvent`、`SessionMeta`
- Produces:
  ```ts
  export const BASE_PATH = "/api/octopus-agent"
  export interface ApiRequest {
    method?: string
    url?: string
    headers?: Record<string, string | string[] | undefined>
    on(event: string, listener: (...args: unknown[]) => void): unknown
  }
  export interface ApiResponse {
    writeHead(status: number, headers?: Record<string, string>): unknown
    write(chunk: string): unknown
    end(body?: string): unknown
    on?(event: string, listener: (...args: unknown[]) => void): unknown
  }
  export interface ApiDeps {
    manager: {
      create(input: { cwd?: string }): Promise<SessionMeta>
      list(): Promise<SessionMeta[]>
      getIndex(id: string, opts?: { allowResume?: boolean }): Promise<EventIndex>
      getStatus(id: string): { live: boolean; status?: "idle" | "running"; pendingApprovalId?: string }
      send(id: string, text: string): Promise<void>
      cancel(id: string): Promise<void>
      dispose(id: string): Promise<void>
      answerApproval(id: string, approvalId: string, decision: "allow" | "deny"): Promise<void>
    }
  }
  export function createAgentApi(deps: ApiDeps): (req: ApiRequest, res: ApiResponse) => Promise<void>
  ```
  - 请求体解析沿用 octopus-projects 的 readJsonBody 模式（`{ JSON.parse → object`，否则 400）
  - 路由（base 前缀解析 + segs）：
    - `GET /up` → `{ ok: true }`
    - `POST /sessions` body `{ cwd?: string; agentPreset?: string; provider?: string; model?: string }` → 201 `{ session }`；cwd 非绝对路径 → 400
    - `GET /sessions` → `{ items }`
    - `GET /sessions/:id/history` → live/resume（allowResume）后 `{ session: { id, createdAt, cwd, title, live: true }, events: index.list(0), lastIdx }`
    - `GET /sessions/:id/status` → manager.getStatus
    - `POST /sessions/:id/messages` body `{ text }`（text 非空/非数组其他字段忽略）→ `{ ok: true }`；500 非 404 复用 ManagerError 映射
    - `POST /sessions/:id/cancel` → `{ ok: true }`
    - `DELETE /sessions/:id` → `{ ok: true }`
    - `POST /sessions/:id/approvals/:approvalId` body `{ decision: "allow" | "deny" }` → `{ ok: true }`；非 "allow"/"deny" → 400；ManagerError APPROVAL_NOT_FOUND → 404
    - `GET /sessions/:id/events` → **SSE**：`writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" })`；先 `index.list(after)`（after = Number(new URL(req.url).searchParams.get("after") ?? 0)，NaN → 0），每条 `id: {idx}\ndata: {json}\n\n`；然后…… SSE 续航：用 `index.subscribe` —— 本任务只做「快照 + close」，订阅交给 Task 6 的 manager 事件直推？**决定：api 层持有 response 生命周期**：向 res 发送 `id: {idx}\ndata: {json}\n\n`；其后监听 `req.on("close")` 停止。manager 没有订阅工厂 → api 通过轮询 `index.list(lastIdx)` `setInterval(250ms)` 追加；有 break。测试用 fake timers。
  - 错误映射：`ManagerError` → SESSION_NOT_FOUND/APPROVAL_NOT_FOUND/AGENT_LOOP_UNAVAILABLE → 404/404/503；ApiError → 其 status；其余 500

- [ ] **Step 1: 写失败测试 api.test.ts**

```ts
import { describe, expect, it, vi } from "vitest"
import { createAgentApi, BASE_PATH, type ApiRequest, type ApiResponse } from "./api"
import type { AgentStreamEvent, SessionMeta } from "./types"

const meta: SessionMeta = { id: "oct-AAAAAAA1", createdAt: "2026-08-28T00:00:00.000Z", cwd: "/x", title: null, live: true }

function fakeReq(method: string, url: string, body?: unknown, listener?: { close?: () => void }): ApiRequest {
  const req: ApiRequest = { method, url, on: vi.fn((ev, cb) => { if (ev === "close" && listener?.close) listener.close(); return 0 }) }
  return req
}
function fakeRes(): { res: ApiResponse & { chunks: string[] }; status: (c: number) => number } {
  const chunks: string[] = []
  const res = {
    writeHead: vi.fn((code: number) => { return 0 }),
    write: vi.fn((chunk: string) => { chunks.push(chunk); return true }),
    end: vi.fn((body?: string) => { if (body) chunks.push(body) }),
    chunks,
    on: vi.fn(),
  } as never
  return { res: res as ApiResponse & { chunks: string[] }, status: () => 0 }
}

function fakeManager(overrides: Partial<ReturnType<typeof baseManager>> = {}) {
  return { indexes: new Map<string, { list: <T>() => T[] }>(), ...overrides }
}

function baseManager() {
  const events: AgentStreamEvent[] = [{ idx: 0, type: "user-message", text: "hi" }, { idx: 1, type: "assistant-text", text: "yo" }]
  const index = { list: vi.fn((from = 0) => events.slice(from)), lastIdx: 1 }
  return {
    create: vi.fn(async () => ({ ...meta, id: "oct-AAAAAAA1" })),
    list: vi.fn(async () => [meta]),
    getIndex: vi.fn(async () => index),
    getStatus: vi.fn(() => ({ live: true, status: "idle" as const, pendingApprovalId: undefined })),
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    answerApproval: vi.fn(async () => {}),
  }
}

describe("octopus-agent api", () => {
  it("up probe returns ok", async () => {
    const handler = createAgentApi({ manager: baseManager() as never })
    const { res } = fakeRes()
    await handler(fakeReq("GET", `${BASE_PATH}/up`), res)
    const body = JSON.parse(res.chunks.join(""))
    expect(body).toEqual({ ok: true })
  })
  it("creates a session and rejects relative cwd", async () => {
    const manager = baseManager()
    const handler = createAgentApi({ manager: manager as never })
    const { res } = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions`, undefined, { close: () => {} }), res)
    expect(JSON.parse(res.chunks.join(""))).toMatchObject({ session: { id: "oct-AAAAAAA1" } })
    await handler(fakeReq("POST", `${BASE_PATH}/sessions`), res)
    // 检查 400：manager.create 不会因相对路径被调用——需要 handler 先校验 body.cwd 是绝对路径
    // 直接以 bad body 验证
    const bad = fakeRes()
    await handler(fakeReq("POST", `${BASE_PATH}/sessions`), bad.res)
    expect(bad.statusCodeWithWriteHead ?? 400).toBeTruthy()
  })
  it("streams history for a session", async () => {
    const manager = baseManager()
    const handler = createAgentApi({ manager: manager as never })
    const { res } = fakeRes()
    await handler(fakeReq("GET", `${BASE_PATH}/sessions/oct-AAAAAAA1/history`), res)
    const data = JSON.parse(res.chunks.join(""))
    expect(data.session.id).toBe("oct-AAAAAAA1")
    expect(data.events).toHaveLength(2)
    expect(data.lastIdx).toBe(1)
  })
})
```

> 说明：上例断言存在内部不一致（bad.cwd 400 场景与 `statusCode` 断言），实现时可简化：handler 先读 body 校验 cwd 绝对路径，再调用 manager.create；mock 期用 `expect(status).toBe(400)` 断言——写 400 断言先实现一个记录 status 的辅助 (`const statusCb = vi.fn(); res.writeHead = statusCb`) 。

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 api.ts**

```ts
import { ManagerError } from "./manager"
import type { AgentStreamEvent, SessionMeta } from "./types"

export const BASE_PATH = "/api/octopus-agent"

export interface ApiRequest {
  method?: string
  url?: string
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface ApiResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  write(chunk: string): unknown
  end(body?: string): unknown
  on?(event: string, listener: (...args: unknown[]) => void): unknown
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export interface IndexLike {
  list(startIdx?: number): AgentStreamEvent[]
  lastIdx: number
}

export interface ApiDeps {
  manager: {
    create(input: { cwd?: string; agentPreset?: string; provider?: string; model?: string }): Promise<SessionMeta>
    list(): Promise<SessionMeta[]>
    getIndex(id: string, opts?: { allowResume?: boolean }): Promise<IndexLike>
    getStatus(id: string): { live: boolean; status?: "idle" | "running"; pendingApprovalId?: string }
    send(id: string, text: string): Promise<void>
    cancel(id: string): Promise<void>
    dispose(id: string): Promise<void>
    answerApproval(id: string, approvalId: string, decision: "allow" | "deny"): Promise<void>
  }
}

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

function segsOf(url: string | undefined, base: string): string[] {
  let pathname = "/"
  try { pathname = decodeURIComponent(new URL(url ?? "/", "http://localhost").pathname) } catch { return [] }
  const sub = pathname.startsWith(base) ? pathname.slice(base.length) : pathname
  return sub.split("/").filter(Boolean)
}

function toError(error: unknown): { status: number; message: string } {
  if (error instanceof ApiError) return { status: error.status, message: error.message }
  if (error instanceof ManagerError) {
    if (error.code === "SESSION_NOT_FOUND" || error.code === "APPROVAL_NOT_FOUND") return { status: 404, message: error.message }
    return { status: 503, message: error.message }
  }
  return { status: 500, message: error instanceof Error ? error.message : String(error) }
}

function afterParam(url: string | undefined): number {
  try {
    const n = Number(new URL(url ?? "/", "http://localhost").searchParams.get("after") ?? 0)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch { return 0 }
}

export function createAgentApi(deps: ApiDeps) {
  const manager = deps.manager
  return async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
    try {
      const method = (req.method ?? "GET").toUpperCase()
      const segs = segsOf(req.url, BASE_PATH)
      const [first, second, third] = segs

      if (method === "GET" && segs.length === 0) {
        sendJson(res, 200, { ok: true })
        return
      }
      if (method === "GET" && first === "up") {
        sendJson(res, 200, { ok: true })
        return
      }
      if (method === "POST" && segs.length === 1 && first === "sessions") {
        const body = await readJsonBody(req)
        const cwd = typeof body.cwd === "string" ? body.cwd : undefined
        if (cwd !== undefined && !cwd.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(cwd)) throw new ApiError(400, "cwd must be an absolute path")
        const session = await manager.create({
          cwd,
          agentPreset: typeof body.agentPreset === "string" ? body.agentPreset : undefined,
          provider: typeof body.provider === "string" ? body.provider : undefined,
          model: typeof body.model === "string" ? body.model : undefined,
        })
        sendJson(res, 201, { session })
        return
      }
      if (method === "GET" && segs.length === 1 && first === "sessions") {
        sendJson(res, 200, { items: await manager.list() })
        return
      }
      if (segments = undefined) return
      // … 其余路由同构；SSE 见下
      sendJson(res, 404, { error: "not found" })
    } catch (error) {
      const { status, message } = toError(error)
      sendJson(res, status, { error: message })
    }
  }
}

const segments = undefined
```

> 部分省略说明：「其余路由同构」在实现中逐一落成（每个 `GET /sessions/:id/:rest`/POST/DELETE 分支都要完整写出），final 版本无 `segments = undefined` 占位。SSE 分支核心：

```ts
      if (method === "GET" && first === "sessions" && second && third === "events") {
        const after = afterParam(req.url)
        const index = await manager.getIndex(second, { allowResume: true })
        const initial = index.list(after)
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        })
        let last = after - 1
        for (const ev of initial) {
          res.write(`id: ${ev.idx}\ndata: ${JSON.stringify(ev)}\n\n`)
          last = ev.idx
        }
        const timer = setInterval(() => {
          const next = index.list(last + 1)
          for (const ev of next) {
            res.write(`id: ${ev.idx}\ndata: ${JSON.stringify(ev)}\n\n`)
            last = ev.idx
          }
        }, 250)
        req.on("close", () => { clearInterval(timer) })
        return
      }
```

- [ ] **Step 4: 测试转绿** — Run: `pnpm --filter octopus-agent test` → PASS

- [ ] **Step 5: Commit** — `feat(octopus-agent): rest api with sse event stream`

---

### Task 6: 插件入口接线

**Files:**
- Create: `packages/octopus-agent/src/index.ts`（重写）、`index.test.ts`（扩展）

**Interfaces:**
- Consumes: `createAgentApi`、`AgentManager`
- Produces: 插件 apply 全貌：
  - `inject = ["webServer", "agents"]`（`sessionPersistence` 以 ctx.get 获取并守卫；缺失时注册 `/up` → 503 与错误日志）
  - `apply`：构造 `AgentManager`（真实 deps：`ctx.agents`、`ctx.sessionPersistence`、id 工厂、配置）；`webServer.register({ kind: "prefix", path: BASE_PATH, handler })`；`ctx.effect` 退订 dispose + `manager.withdraw()`
  - 模型默认：`ctx.get("agentDefaultModel")?.currentSelection()` → `{ provider, model }`，configured `provider`/`model` 优先
  - 审批 Outcome 桥：agent ctx listener next() 无真实 Outcome 语义（dsh approval 的 waterfall 是 `approval/request` 事件 listeners 返回 outcome；本插件 listener 内不做 next()，只挂起 Promise——真实 outcome 为 `allow`/`deny` 字符串），实现为：

```ts
agent.ctx.on("approval/request", (req: { toolName?: string; reason?: string }, next: () => Promise<unknown>) => {
  const id = ...
  return new Promise<string>((resolveOutcome) => {
    entry.pendingApprovals.set(id, { approval, resolve: (decision) => resolveOutcome(decision) })
  }).then(() => void next)
})
```

> 注：dsh `approval/request` waterfall listener 返回 `ApprovalOutcome`（'allow'|'deny'|…）而非 `next()`；实现按 waterfall 契约直返 outcome（Promise<string>），`next` 参数仅在需要委托时调用。此细节在 manager 的 Test 4 钩子已占位，Task 6 修正 manager 中 listener 以契约对齐（listener 直接 `return new Promise<string>(...)`，不调用 next()）。

- [ ] **Step 1: 写 index.test.ts**

```ts
import { describe, expect, it, vi } from "vitest"
import { Config, apply, inject, name } from "./index"

function stubWebServer() {
  return { register: vi.fn(() => () => {}) }
}
function stubAgents() {
  return {
    create: vi.fn(async () => { throw new Error("no loop") }),
    resume: vi.fn(async () => { throw new Error("no loop") }),
  }
}
function stubCtx(target = {}) {
  const effectFn = vi.fn((fn: unknown) => { const d = typeof fn === "function" ? (fn as () => unknown)() : undefined; return typeof d === "function" ? (d as () => void) : () => {} })
  return {
    value: target,
    on: vi.fn(),
    effect: effectFn,
    provide: vi.fn(),
    plugin: vi.fn(),
    get: vi.fn((key: string) => (key === "sessionPersistence" ? { load: vi.fn(), listSnapshots: vi.fn(async () => []) } : undefined)),
  }
}

describe("octopus-agent plugin apply", () => {
  it("registers api route on webServer and up responds", async () => {
    const webServer = stubWebServer()
    const ctx = stubCtx() as never
    await (apply as (c: typeof ctx, config: unknown) => Promise<void>)(ctx, Config())
    expect(ctx.effect).toHaveBeenCalled()
    expect(webServer.register).toHaveBeenCalledWith(expect.objectContaining({ kind: "prefix", path: "/api/octopus-agent" }))
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 index.ts 完整接线 + manager 契约修正**

把 Task 4 的 approval listener 改为 waterfall 直返 Outcome（不调用 next()）；deps 传 `approvalOutcomeBridge`（`(decision) => "allow" | "deny"`）。

- [ ] **Step 4: 测试转绿 + 全量** — Run: `pnpm --filter octopus-agent test ; pnpm --filter octopus-agent build`

- [ ] **Step 5: Commit** — `feat(octopus-agent): plugin wiring with route registration`

---

### Task 7: 壳前端 AgentClient 双实现重构

**Files:**
- Modify: `packages/octopus/web/src/lib/types.ts`（增加 `AgentStreamEvent`/`SessionMeta`/`ApprovalBlock` block kind）
- Rewrite: `packages/octopus/web/src/lib/agent-client.ts`
- Rewrite: `packages/octopus/web/src/lib/agent-client.test.ts`

**Interfaces:**
- Produces：
  ```ts
  export type AgentStreamEvent = { idx: number } & (
    | { type: "status"; status: "idle" | "running" }
    | { type: "user-message"; text: string }
    | { type: "assistant-text"; text: string }
    | { type: "tool-call"; callId: string; name: string; summary: string }
    | { type: "tool-result"; callId: string; ok: boolean; preview: string }
    | { type: "turn"; at: "start" | "end"; reason?: string }
    | { type: "question"; id: string; question: string; options?: string[] }
    | { type: "approval"; id: string; toolName: string; reason?: string }
    | { type: "error"; message: string }
  )
  export interface SessionMeta { id: string; createdAt: string; cwd: string | null; title: string | null; live: boolean }
  export type ApprovalBlock = { kind: "approval"; approvalId: string; toolName: string; reason?: string }
  // MessageBlock 联合类型新增：{ kind: "approval"; approvalId: string; toolName: string; reason?: string }
  export interface AgentClient {
    startSession(opts?: { cwd?: string }): Promise<string>
    switchTo(sessionId: string): Promise<void>
    listSessions(): Promise<SessionMeta[]>
    history(sessionId: string): Promise<AgentStreamEvent[]>
    subscribe(handler: (ev: AgentStreamEvent) => void): () => void
    send(text: string): Promise<void>
    cancel(): Promise<void>
    disposeSession(): Promise<void>
    answerApproval(id: string, decision: "allow" | "deny"): Promise<void>
  }
  export function createMockAgentClient(delayMs?: number): AgentClient
  export function createHttpAgentClient(baseUrl?: string): AgentClient
  export function createDefaultAgentClient(fetchImpl?: typeof fetch): Promise<AgentClient>
  ```
  - `createDefaultAgentClient` 异步化（App 侧 useMemo 改 useEffect/memo Promise）——**兼容策略**：App 调用点改为 `createDefaultAgentClient().then(setClient)`；`AgentClient` 初始为空时 ChatPane 禁用输入（`disabled`），mock 兜底在 promise reject 时
  - `createHttpAgentClient`：内部维护 `sessionId`（startSession 后）与 `eventsource`；`send` = POST messages；`history` = GET history events（`view` 含 `entry.status`）；`subscribe` 注册 handler 后开 EventSource（URL 带 `after=当前 lastIdx`；onmessage 过滤 `idx > lastIdx`）；`EventSource` close on unsubscribe/dispose（**jsdom 兼容**：环境无 EventSource 时降级为 250ms 轮询 `GET /sessions/:id/events?after=` —— fetch 驱动的同一 handler，测试用 fake fetch 覆盖两条路径）
  - mock 版：`startSession` 返回 `"mock"`；`send` 用现有人脚本（PRIORITY/DELEGATION/ACK）转成事件序列异步派发 `subscribe` handler；`listSessions` 返回 `[{ id: "mock", createdAt: new Date().toISOString(), cwd: null, title: "Mock 会话", live: true }]`

- [ ] **Step 1: 改写测试 agent-client.test.ts**

```ts
import { describe, expect, it, vi } from "vitest"
import { createDefaultAgentClient, createHttpAgentClient, createMockAgentClient } from "./agent-client"

function fakeFetchImpl(ok: boolean) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/octopus-agent/up") return new Response(ok ? JSON.stringify({ ok: true }) : "", { status: ok ? 200 : 503 })
    if (url.includes("/history")) return new Response(JSON.stringify({ session: { id: "s1", createdAt: "t", cwd: null, title: null, live: true }, events: [{ idx: 0, type: "user-message", text: "hi" }], lastIdx: 0 }))
    if (url.includes("/sessions") && !url.includes("messages")) return new Response(JSON.stringify({ session: { id: "s1", createdAt: "t", cwd: null, title: "t", live: true } }))
    return new Response(JSON.stringify({ ok: true }))
  })
}

describe("mock agent client", () => {
  it("returns mock session and streams scripted events", async () => {
    const client = createMockAgentClient(0)
    const received: string[] = []
    client.subscribe((ev) => { if (ev.type === "assistant-text" || ev.type === "user-message") received.push(ev.type) })
    const id = await client.startSession()
    expect(id).toBe("mock")
    await client.send("先列一下优先事项")
    expect(received).toContain("user-message")
    expect(received).toContain("assistant-text")
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 agent-client.ts（保持 `AgentClient` 导出名，新增 http/mock/default）** — 完整代码以 mock 脚本事件序列化 + http 映射为准，EventSource 缺失降级轮询（用 `typeof EventSource === "undefined"` 判定）。探测：`fetch("/api/octopus-agent/up", { signal: AbortSignal.timeout(1500) })` 非 200 → mock。

- [ ] **Step 4: 测试转绿** — Run: `pnpm --filter octopus exec vitest run --root web src/lib/agent-client.test.ts`

- [ ] **Step 5: Commit** — `refactor: event-driven agent client with http and mock implementations`

---

### Task 8: useChat 流式重写

**Files:**
- Rewrite: `packages/octopus/web/src/lib/use-chat.ts`
- Rewrite: `packages/octopus/web/src/lib/use-chat.test.tsx`

**Interfaces:**
- Produces：
  ```ts
  export type ChatStatus = "idle" | "thinking"
  export type PendingQuestion = { id: string; question: string; options?: string[] } | null
  export function useChat(client: AgentClient, opts?: { contextLabel?: string }): {
    messages: ChatMessage[]
    status: ChatStatus
    send: (text: string) => void
    artifacts: Artifact[]
    pendingQuestion: PendingQuestion
    answerQuestion: (text: string) => void
    approvals: ApprovalBlock[]
    decideApproval: (id: string, decision: "allow" | "deny") => void
    thinking: boolean
  }
  ```
  - 订阅 client 事件：`user-message` → append user message；`assistant-text` → 汇总（同 turn 合并或逐条）；`turn at:start/end` → thinking 态（turn-start 置 thinking=true，turn-end false）；`status` → thinking = last status === "running" || openTurn；`tool-call`/`tool-result` → 转 notice block（到消息的 blocks 尾）；`approval` → 追加 `ApprovalBlock` 消息（kind "approval"）；`question` → pendingQuestion
  - **artifacts 派生规则**：`tool-call` 的 name ∈ `todo_write` → `{ id: callId, kind: "task", title: summary 前 24 字符, subtitle: "Agent 任务清单", live: true }`；name ∈ `str_replace_editor`/`write_file`/`edit_file` → `{ id: callId, kind: "doc", title: summary 首行 24 字符, subtitle: "Agent 产出", live: false }`；按 callId 去重（先到先得）。mock client 的脚本事件改为直接发射带 `callId` 的 `tool-call`（todo_write/str_replace_editor）事件，复用同一派生规则
  - welcome 首条文案同现有（greeting.ts `timeGreeting`），首条「mock/真实」由会话 meta 决定（保持现有欢迎文本）
  - 迁移测试到 `client` fake（记录事件流并手工 emit）

- [ ] **Step 1: 改写 use-chat.test.tsx**（fake client + 事件时序）

- [ ] **Step 2: 确证失败** — Run: `pnpm --filter octopus exec vitest run --root web src/lib/use-chat.test.tsx` → FAIL

- [ ] **Step 3: 实现 use-chat.ts** — send() 内：`client.send(text)`；切换状态由事件驱动；thinking 期间 send 忽略

- [ ] **Step 4: 转绿** — Run: `pnpm --filter octopus exec vitest run --root web src/lib/use-chat.test.tsx`

- [ ] **Step 5: Commit** — `feat: streaming use-chat over agent client events`

---

### Task 9: ChatMessage approval 块 + ChatPane 会话切换

**Files:**
- Modify: `packages/octopus/web/src/components/ChatMessage.tsx`（approval 块渲染 + 测试）
- Modify: `packages/octopus/web/src/components/ChatPane.tsx`（会话下拉 + 审批回调上行 + 测试）

**Interfaces:**
- `ChatMessage` props 增加 `onApprovalDecision?: (id: string, decision: "allow" | "deny") => void`
- `approval` block 渲染：卡内「允许」（primary）/「拒绝」（ghost danger）按钮 + `data-testid="approval-{id}"`；决策后 disable（通过父级状态回调上浮，ChatPane 本地状态记录已决策 id）
- `ChatPane` 头部「会话」DropdownMenu（octopus-ui）：菜单项「新建会话」+ 最近 `listSessions()`（最多 20）；点击切换 → `client.switchTo` + `history()` 全量重载消息 + 重新订阅

- [ ] **Step 1: 先写 ChatMessage.test.tsx 追加用例**（approval 按钮出现、点击回调）

- [ ] **Step 2: 实现 ChatMessage approval 渲染** — 样式走 Tailwind：卡内按钮 `bg-danger text-white` / `bg-surface-hover`，文案「允许」「拒绝」

- [ ] **Step 3: ChatPane 测试 + 其实现** — test：mock client（subscribe 手动 emit），验证"会话"下拉出现、click 新会话调 startSession、审批点击回调上浮

- [ ] **Step 4: 全量 web 测试转绿** — Run: `pnpm --filter octopus exec vitest run --root web`

- [ ] **Step 5: Commit** — `feat: approval blocks and session switcher in chat pane`

---

### Task 10: App 接线与验收

**Files:**
- Modify: `packages/octopus/web/src/App.tsx`（异步 client 初始化：`useMemo(createDefaultAgentClient, [])` → `useEffect` + state；`startSession` 传入当前项目 `records[current?.id]?.workspacePath`；ChatPane props 增 `currentCwd`）
- Modify: `packages/octopus/web/src/App.test.tsx`（mock fetch/agent client）
- Modify: `packages/octopus/web/src/components/ChatPane.tsx`（通过 props 接 currentCwd）

**Interfaces:**
- App 变更：`const [agentClient, setAgentClient] = useState<AgentClient | null>(null)` + `useEffect(() => { void createDefaultAgentClient().then(setAgentClient) }, [])`；`ChatPane agentClient={agentClient} currentCwd={records[current?.id]?.workspacePath} ...`

- [ ] **Step 1: App.test.tsx 更新**（vi.mock("./lib/datasource") 的 createDefaultAgentClient → resolve mock client；保留既有用例可过）

- [ ] **Step 2: App.tsx 接线** — 空 client 时 ChatPane 渲染（内部禁用输入：「正在准备 Agent…」）

- [ ] **Step 3: 全量验收**

Run: `pnpm --filter octopus exec vitest run --root web ; pnpm --filter octopus exec tsc -p web/tsconfig.json --noEmit ; pnpm --filter octopus build ; pnpm --filter octopus-agent test ; pnpm --filter octopus-agent build`
Expected: 全绿。

- [ ] **Step 4: 手工冒烟（pnpm dev:noopen，需 DEEPSEEK_API_KEY）**：新建项目 → 聊天发消息 → 真实回复；查看 tool-call notice；写文件触发审批 → 允许/拒绝按钮；切历史会话回放；删插件（临时注释）→ 登录后聊天回退 mock 样式

- [ ] **Step 5: Commit** — `feat: wire real agent sessions through workbench app`

---

## Self-Review 记录

- **Spec 覆盖**：/up 探测（T7）✔；POST/GET sessions、history、events SSE、messages、cancel、DELETE、approvals（T5/T6）✔；审批桥（T4/T6 waterfall）✔；user-questions 注册失败降级（T6 注释 + README）✔；AgentClient 缝事件化双实现（T7）✔；useChat 流式（T8）✔；approval 块 + ChatMessage（T9）✔；会话切换器（T9）✔；ArtifactsRail 真实产出投影——**缺口**：T8 只投影 tool-call 进入 messages 的 notice，未产出 Artifact 列表；补齐：T8 内 `artifacts` 从 `tool-call` of `todo_write`/`str_replace_editor` 派生（kind: task/doc）并在 use-chat 内聚合成 Artifact[]；mock 版按脚本不变（用现有 INITIAL_ARTIFACTS 派发模式）。**已在 Task 8 Interfaces 中加「todo_write/str_replace_editor 事件 → artifacts」规则。**
- **占位扫描**：Task 5 的 api.ts 只展示骨架与 SSE 主分支——正文明确要求「其余路由在实现中逐一落成（完整写出）」；Task 5 Step 1 测试含一处对内部不一致的说明（400 断言改为 `vi.fn` 记录 status），实现时按说明执行；Task 1 package.json 的 tsc-alias 备注「以 octopus 包做法为准」需实现者在写 scaffold 时先查 octopus 包（已在步骤 1 前置）。
- **类型一致性**：`AgentStreamEvent` 带 `idx`（T3 定义并被 T5 SSE/客户端识别）；`AgentClient`（T7）被 useChat（T8）与 App（T10）消费签名一致；`ManagerError`（T4）被 api（T5）映射一致；`ApprovalDecision` "allow"|"deny"（T4）被 client（T7）/ChatMessage（T9）复用；`ApprovalBlock` 类型名在 T9 使用但未在 T8 Interfaces 定义——已在 T8 补充 `export type ApprovalBlock = { kind: "approval"; approvalId: string; toolName: string; reason?: string }`（defs 在 agent-client.ts？放 types.ts）。T9 消费 `ApprovalBlock` 引用 `web/src/lib/types.ts`。
