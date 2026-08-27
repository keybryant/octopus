# Octopus 用户权限体系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为工作台增加认证授权体系——三个新插件（octopus-users 数据层 / octopus-auth 协议层 / octopus-users-view 管理界面）+ 壳的最小改造。

**Architecture:** 方案 D：壳硬依赖 octopus-auth（deny-by-default）；users 插件独占 dsh-storage KV 单元并提供无头数据服务（内部 promise 写链串行化）；auth 持有全部 HTTP 端点与协议逻辑（scrypt、Cookie 会话、限速、CSRF Origin 校验）；view 只走 HTTP 调 auth API。支持 single-user 直通模式与 forward-auth `/verify` 端点。

**Tech Stack:** TypeScript 5.6 strict ESM (NodeNext)、Cordis 4 插件模型、@deepseek-ai/schemastery 配置、@deepseek-ai/dsh-storage KV 单元、node:crypto scrypt、Vite 6 library 构建、Vitest 4。

**Spec:** `docs/superpowers/specs/2026-08-25-octopus-auth-design.md`

## Global Constraints

- Node >= 22.19；所有包 `"type": "module"`；tsconfig 与 `packages/octopus-quickstart/` 的对应文件字节级同构（ES2022/NodeNext/strict，build 输出 `lib/` + `lib/types/`，排除 `src/**/*.test.ts`）。
- 运行时依赖白名单：工作区包、`@deepseek-ai/schemastery ^3.18.1`（仅 auth 需要）、`@deepseek-ai/dsh-storage ^0.1.1-rc.2`（仅 users 需要）。密码哈希只用 `node:crypto` scrypt。禁止引入其他运行时依赖。
- **octopus-auth 与 octopus-users 不得 import 运行时符号 from `octopus`**（octopus → auth → users 单向，防循环）。跨包引用类型一律 `import type`。octopus-users-view 可以运行时 import octopus（先例：quickstart 的 `serveStaticFiles`）。
- scrypt 参数固定：N=16384, r=8, p=1, keylen=32, salt=16 字节随机；存储格式 `scrypt$16384$8$1$<salt-hex>$<hash-hex>`；校验用 `timingSafeEqual`。
- 存储单元：`name: 'octopus-users'`, `version: 1`, `tables: ['users','sessions']`, `hasGlobal: false`；所有写操作经 promise 写链串行化。
- 会话：ID=`randomBytes(32)` base64url；Cookie 名 `octopus_session`（secureCookie 时 `__Host-octopus_session`），属性 HttpOnly/SameSite=Lax/Path=/，永不设 Domain；绝对过期默认 7 天；每用户活跃会话上限 20，超出逐出 createdAt 最旧。
- 登录限速：15 分钟窗口失败 ≥5 次 → 429 + 指数退避（封顶 64 分钟），成功清零。变更类请求（POST/PATCH/DELETE）Origin 缺失或不匹配 → 403。所有变更操作必须是非 GET 方法。
- 自我保护：不能禁用/删除自己（400 self-operation）；不能使最后一个可用 admin 消失（400 last-admin）。输入校验：username trim 后非空且不含空白字符；password 最短 8 位；重复用户名 → 409 conflict；UsersError 映射 invalid/not-found→400/404。
- UI 文案中文；commit 格式沿用仓库惯例（`feat(octopus-users): ...` 等）。
- 每个任务以 `pnpm --filter <pkg> test` 全绿收尾再提交。

---

### Task 1: octopus-users 包骨架 —— 存储单元打开 + 写链

**Files:**
- Create: `packages/octopus-users/package.json`
- Create: `packages/octopus-users/tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `cordis.patch.yml`
- Create: `packages/octopus-users/src/types.ts`, `src/write-chain.ts`, `src/unit.ts`, `src/index.ts`
- Test: `packages/octopus-users/src/write-chain.test.ts`, `src/unit.test.ts`

**Interfaces:**
- Consumes: 平台 `@deepseek-ai/dsh-storage` 的 `StorageBackend`/`KvUnitDescriptor`/`KvUnit` 类型（`lib/types/index.d.ts`）。
- Produces:
  ```ts
  // types.ts
  export interface UserRecord { id: string; username: string; passwordHash: string; role: 'admin' | 'user'; disabled: boolean; createdAt: number }
  export interface SessionRecord { id: string; userId: string; createdAt: number; expiresAt: number }
  export type UsersErrorCode = 'invalid' | 'conflict' | 'not-found' | 'closed'
  export class UsersError extends Error { readonly code: UsersErrorCode } // message 前缀 "[octopus-users] "
  // write-chain.ts
  export class WriteChain { run<T>(job: () => Promise<T>): Promise<T> }  // 串行执行；前序失败不阻断后续
  // unit.ts
  export const USERS_UNIT_DESCRIPTOR: KvUnitDescriptor  // { name:'octopus-users', version:1, tables:['users','sessions'], hasGlobal:false }
  export function openUsersUnit(backend: StorageBackend): Promise<KvUnit>  // backend.kv 缺失时 throw Error(/kv facet/)
  ```

- [ ] **Step 1: 创建包骨架文件**

`package.json`：
```json
{
  "name": "octopus-users",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "import": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@deepseek-ai/dsh-storage": "^0.1.1-rc.2"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "typescript": "^5.6.0",
    "vitest": "^4.1.8"
  },
  "dsh.bundle.patch": "./cordis.patch.yml"
}
```

`tsconfig.json` / `tsconfig.build.json` / `vitest.config.ts`：从 `packages/octopus-quickstart/` 对应文件原样复制。

`cordis.patch.yml`：
```yaml
- insert:
    - id: octopus-users
      name: octopus-users
```

`src/types.ts`：
```ts
export interface UserRecord {
  id: string
  username: string
  passwordHash: string
  role: 'admin' | 'user'
  disabled: boolean
  createdAt: number
}

export interface SessionRecord {
  id: string
  userId: string
  createdAt: number
  expiresAt: number
}

export type UsersErrorCode = 'invalid' | 'conflict' | 'not-found' | 'closed'

export class UsersError extends Error {
  readonly code: UsersErrorCode
  constructor(code: UsersErrorCode, message: string) {
    super(`[octopus-users] ${message}`)
    this.name = 'UsersError'
    this.code = code
  }
}
```

`src/write-chain.ts`：
```ts
/** 后端契约要求调用方保证写序：所有 put/delete 经此链串行执行 */
export class WriteChain {
  private tail: Promise<void> = Promise.resolve()

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
```

`src/unit.ts`：
```ts
import type { KvUnitDescriptor, KvUnit, StorageBackend } from "@deepseek-ai/dsh-storage"

export const USERS_UNIT_DESCRIPTOR: KvUnitDescriptor = {
  name: "octopus-users",
  version: 1,
  tables: ["users", "sessions"],
  hasGlobal: false,
}

export function openUsersUnit(backend: StorageBackend): Promise<KvUnit> {
  if (!backend.kv) throw new Error("[octopus-users] storage backend 不支持 kv facet")
  return backend.kv.open(USERS_UNIT_DESCRIPTOR)
}
```

`src/index.ts`（Task 2 会替换为完整插件入口）：
```ts
export { USERS_UNIT_DESCRIPTOR, openUsersUnit } from "./unit.js"
export { WriteChain } from "./write-chain.js"
export { UsersError } from "./types.js"
export type { SessionRecord, UserRecord, UsersErrorCode } from "./types.js"
```

- [ ] **Step 2: 写测试**

`src/write-chain.test.ts`：
```ts
import { describe, expect, it } from "vitest"
import { WriteChain } from "./write-chain.js"

describe("WriteChain", () => {
  it("按提交顺序串行执行任务", async () => {
    const chain = new WriteChain()
    const order: number[] = []
    const jobs = [1, 2, 3].map((n) =>
      chain.run(async () => {
        await new Promise((r) => setTimeout(r, 3 - n))
        order.push(n)
        return n * 10
      }),
    )
    expect(await Promise.all(jobs)).toEqual([10, 20, 30])
    expect(order).toEqual([1, 2, 3])
  })

  it("前一个任务失败不阻断后续任务", async () => {
    const chain = new WriteChain()
    await expect(chain.run(async () => { throw new Error("boom") })).rejects.toThrow("boom")
    await expect(chain.run(async () => "ok")).resolves.toBe("ok")
  })
})
```

`src/unit.test.ts`（`createFakeBackend` 供后续任务复用）：
```ts
import { describe, expect, it } from "vitest"
import type { KvUnitDescriptor, KvUnit, StorageBackend } from "@deepseek-ai/dsh-storage"
import { openUsersUnit } from "./unit.js"

export function createFakeBackend(): StorageBackend & { units: Map<string, KvUnit> } {
  const units = new Map<string, KvUnit>()
  return {
    units,
    close: async () => undefined,
    kv: {
      async open(descriptor: KvUnitDescriptor) {
        if (units.has(descriptor.name)) throw new Error("already-open")
        const tables: Record<string, Record<string, unknown>> = {}
        for (const t of descriptor.tables) tables[t] = {}
        const unit: KvUnit = {
          async loadAll() {
            return { tables: structuredClone(tables), global: null }
          },
          async putRecord(table, key, value) {
            tables[table][key] = structuredClone(value)
          },
          async deleteRecord(table, key) {
            delete tables[table][key]
          },
          async setGlobal() {
            throw new Error("hasGlobal=false")
          },
          async close() {
            units.delete(descriptor.name)
          },
        }
        units.set(descriptor.name, unit)
        return unit
      },
    },
  }
}

describe("openUsersUnit", () => {
  it("使用固定描述符打开单元", async () => {
    const backend = createFakeBackend()
    const unit = await openUsersUnit(backend)
    const snapshot = await unit.loadAll()
    expect(Object.keys(snapshot.tables).sort()).toEqual(["sessions", "users"])
  })

  it("后端不支持 kv facet 时报错", () => {
    expect(() => openUsersUnit({ close: async () => undefined } as StorageBackend)).toThrow(/kv facet/)
  })
})
```

- [ ] **Step 3: 安装并运行测试**

Run: `pnpm install && pnpm --filter octopus-users test`
Expected: PASS（4 个用例）

- [ ] **Step 4: Commit**

```bash
git add packages/octopus-users pnpm-lock.yaml
git commit -m "feat(octopus-users): add package skeleton with kv unit opener and write chain"
```

---

### Task 2: octopus-users 数据服务 + 插件本体

**Files:**
- Create: `packages/octopus-users/src/service.ts`
- Modify: `packages/octopus-users/src/index.ts`
- Test: `packages/octopus-users/src/service.test.ts`, `src/plugin.test.ts`

**Interfaces:**
- Consumes: Task 1 全部导出；平台 `StorageBackend`。
- Produces（auth 任务与壳依赖的精确签名与语义）:
  ```ts
  export interface UsersService {
    findByUsername(username: string): Promise<UserRecord | null>
    getUser(id: string): Promise<UserRecord | null>
    listUsers(): Promise<UserRecord[]>                       // 按 createdAt 升序
    createUser(input: { username: string; passwordHash: string; role: 'admin' | 'user' }): Promise<UserRecord>
    updateUser(id: string, patch: Partial<Pick<UserRecord, 'role' | 'disabled' | 'passwordHash'>>): Promise<UserRecord>
    deleteUser(id: string): Promise<void>                    // 级联删除该用户全部会话
    countActiveAdmins(): Promise<number>                     // 不计 disabled
    getSession(id: string): Promise<SessionRecord | null>    // 过期记录惰性删除并返回 null
    putSession(record: SessionRecord): Promise<void>         // 每用户 >20 条逐出最旧
    deleteSession(id: string): Promise<void>                 // 幂等
    deleteExpiredSessions(now: number): Promise<number>
    deleteUserSessions(userId: string): Promise<number>
    close(): Promise<void>
  }
  export function createUsersService(backend: StorageBackend): UsersService
  // 插件：name="octopus-users"，inject=["storage"]，provide "users"，
  // 后端解析固定 ctx.storage.backend.get("json")，effect 卸载时调用 service.close()
  ```
  错误语义：用户名非法 → UsersError('invalid')；重复（大小写不敏感）→ ('conflict')；update/delete 目标不存在 → ('not-found')；关闭后任何调用 → ('closed')。

- [ ] **Step 1: 写失败测试 `src/service.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { createFakeBackend } from "./unit.test.js"
import { createUsersService, type UsersService } from "./service.js"
import type { SessionRecord, UserRecord } from "./types.js"

function seedUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: randomUUID(), username: "alice", passwordHash: "scrypt$16384$8$1$aa$bb",
    role: "user", disabled: false, createdAt: Date.now(), ...overrides,
  }
}

describe("createUsersService", () => {
  let service: UsersService
  beforeEach(() => { service = createUsersService(createFakeBackend()) })

  it("创建并读取用户，findByUsername 大小写不敏感", async () => {
    const created = await service.createUser({ username: "Alice", passwordHash: "h1", role: "admin" })
    expect(created).toMatchObject({ username: "Alice", role: "admin", disabled: false })
    await expect(service.getUser(created.id)).resolves.toMatchObject({ id: created.id })
    await expect(service.findByUsername("alice")).resolves.toMatchObject({ id: created.id })
  })

  it("拒绝非法用户名（空/含空白）", async () => {
    await expect(service.createUser({ username: "  ", passwordHash: "h", role: "user" })).rejects.toMatchObject({ code: "invalid" })
    await expect(service.createUser({ username: "a b", passwordHash: "h", role: "user" })).rejects.toMatchObject({ code: "invalid" })
  })

  it("重复用户名返回 conflict（大小写不敏感）", async () => {
    await service.createUser({ username: "alice", passwordHash: "h", role: "user" })
    await expect(service.createUser({ username: "ALICE", passwordHash: "h", role: "user" })).rejects.toMatchObject({ code: "conflict" })
  })

  it("updateUser 更新字段；目标不存在抛 not-found", async () => {
    const u = await service.createUser({ username: "bob", passwordHash: "h", role: "user" })
    const updated = await service.updateUser(u.id, { role: "admin", passwordHash: "h2" })
    expect(updated).toMatchObject({ role: "admin", passwordHash: "h2" })
    await expect(service.updateUser("nope", { disabled: true })).rejects.toMatchObject({ code: "not-found" })
    await expect(service.deleteUser("nope")).rejects.toMatchObject({ code: "not-found" })
  })

  it("deleteUser 级联删除会话", async () => {
    const u = await service.createUser({ username: "carol", passwordHash: "h", role: "user" })
    await service.putSession({ id: "s1", userId: u.id, createdAt: 1, expiresAt: Date.now() + 60_000 })
    await service.deleteUser(u.id)
    await expect(service.getUser(u.id)).resolves.toBeNull()
    await expect(service.getSession("s1")).resolves.toBeNull()
  })

  it("countActiveAdmins 不计 disabled", async () => {
    const a = await service.createUser({ username: "root", passwordHash: "h", role: "admin" })
    expect(await service.countActiveAdmins()).toBe(1)
    await service.updateUser(a.id, { disabled: true })
    expect(await service.countActiveAdmins()).toBe(0)
  })

  it("listUsers 按 createdAt 升序返回全部", async () => {
    const u1 = await service.createUser({ username: "u1", passwordHash: "h", role: "user" })
    const u2 = await service.createUser({ username: "u2", passwordHash: "h", role: "admin" })
    expect((await service.listUsers()).map((x) => x.id)).toEqual([u1.id, u2.id])
  })

  it("put/get/delete 会话；读过期会话惰性删除", async () => {
    await service.putSession({ id: "live", userId: "u1", createdAt: 1, expiresAt: Date.now() + 60_000 })
    await expect(service.getSession("live")).resolves.toBeTruthy()
    await service.putSession({ id: "stale", userId: "u1", createdAt: 1, expiresAt: 1 })
    await expect(service.getSession("stale")).resolves.toBeNull()
    await expect(service.getSession("stale")).resolves.toBeNull()
    await service.deleteSession("live")
    await expect(service.getSession("live")).resolves.toBeNull()
  })

  it("每用户最多 20 个会话，超出逐出最旧", async () => {
    const base = Date.now()
    for (let i = 0; i <= 20; i++) {
      await service.putSession({ id: `s${i}`, userId: "u1", createdAt: base + i, expiresAt: base + 999_999 })
    }
    await expect(service.getSession("s0")).resolves.toBeNull()
    await expect(service.getSession("s1")).resolves.toBeNull()
    await expect(service.getSession("s20")).resolves.toMatchObject({ id: "s20" })
  })

  it("deleteExpiredSessions / deleteUserSessions 正确计数", async () => {
    const now = Date.now()
    await service.putSession({ id: "live", userId: "a", createdAt: 1, expiresAt: now + 1000 })
    await service.putSession({ id: "dead", userId: "a", createdAt: 1, expiresAt: now - 1000 })
    expect(await service.deleteExpiredSessions(now)).toBe(1)
    await service.putSession({ id: "b", userId: "b", createdAt: 1, expiresAt: now + 1000 })
    expect(await service.deleteUserSessions("a")).toBe(1)
    await expect(service.getSession("b")).resolves.toBeTruthy()
  })

  it("并发写经写链串行化且全部生效", async () => {
    const u = await service.createUser({ username: "dana", passwordHash: "h", role: "user" })
    await Promise.all([
      service.updateUser(u.id, { role: "admin" }),
      service.updateUser(u.id, { passwordHash: "h9" }),
    ])
    await expect(service.getUser(u.id)).resolves.toMatchObject({ role: "admin", passwordHash: "h9" })
  })

  it("close 后调用抛 closed", async () => {
    await service.close()
    await expect(service.listUsers()).rejects.toMatchObject({ code: "closed" })
  })

  it("seedUser 辅助可用", () => {
    expect(seedUser().username).toBe("alice")
    void ({} as SessionRecord)
  })
})
```

- [ ] **Step 2: 写插件装配失败测试 `src/plugin.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest"
import { apply, name, inject } from "./index.js"

describe("octopus-users plugin", () => {
  it("声明与契约一致", () => {
    expect(name).toBe("octopus-users")
    expect(inject).toEqual(["storage"])
  })

  it("提供 users 服务并解析 json 后端", () => {
    const provide = vi.fn()
    const backendGet = vi.fn(() => ({ kv: undefined, close: async () => undefined }))
    const ctx: any = {
      storage: { backend: { get: backendGet } },
      provide,
      effect: vi.fn(),
    }
    apply(ctx)
    expect(provide).toHaveBeenCalledWith("users", expect.objectContaining({
      createUser: expect.any(Function),
    }))
    expect(backendGet).toHaveBeenCalledWith("json")
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter octopus-users test`
Expected: FAIL（service.js / index.js 导出不存在）

- [ ] **Step 4: 实现 `src/service.ts`**

```ts
import { randomUUID } from "node:crypto"
import type { KvUnit, StorageBackend } from "@deepseek-ai/dsh-storage"
import { openUsersUnit } from "./unit.js"
import { WriteChain } from "./write-chain.js"
import { UsersError, type SessionRecord, type UserRecord } from "./types.js"

const USERNAME_RE = /^\S+$/
const MAX_SESSIONS_PER_USER = 20

function validateUsername(username: string): string {
  const trimmed = username.trim()
  if (!trimmed || !USERNAME_RE.test(trimmed)) {
    throw new UsersError("invalid", "用户名不能为空且不能含空白字符")
  }
  return trimmed
}

type Snapshot = { tables: Record<string, Record<string, unknown>>; global: unknown }

function usersOf(snapshot: Snapshot) { return snapshot.tables["users"] as Record<string, UserRecord> }
function sessionsOf(snapshot: Snapshot) { return snapshot.tables["sessions"] as Record<string, SessionRecord> }

export function createUsersService(backend: StorageBackend): UsersService {
  let unitPromise: Promise<KvUnit> | null = null
  let closed = false
  const chain = new WriteChain()

  function ensureOpen(): Promise<KvUnit> {
    if (closed) return Promise.reject(new UsersError("closed", "service 已关闭"))
    if (unitPromise === null) unitPromise = openUsersUnit(backend)
    return unitPromise
  }

  const service = {
    async findByUsername(username: string): Promise<UserRecord | null> {
      const wanted = username.trim().toLowerCase()
      const users = usersOf(await (await ensureOpen()).loadAll())
      return Object.values(users).find((u) => u.username.toLowerCase() === wanted) ?? null
    },

    async getUser(id: string): Promise<UserRecord | null> {
      return usersOf(await (await ensureOpen()).loadAll())[id] ?? null
    },

    async listUsers(): Promise<UserRecord[]> {
      return Object.values(usersOf(await (await ensureOpen()).loadAll()))
        .sort((a, b) => a.createdAt - b.createdAt)
    },

    createUser(input: { username: string; passwordHash: string; role: "admin" | "user" }): Promise<UserRecord> {
      const username = validateUsername(input.username)
      if (!input.passwordHash) throw new UsersError("invalid", "passwordHash 不能为空")
      return chain.run(async () => {
        const unit = await ensureOpen()
        const duplicated = Object.values(usersOf(await unit.loadAll()))
          .some((u) => u.username.toLowerCase() === username.toLowerCase())
        if (duplicated) throw new UsersError("conflict", `用户名已存在: ${username}`)
        const record: UserRecord = {
          id: randomUUID(), username, passwordHash: input.passwordHash,
          role: input.role, disabled: false, createdAt: Date.now(),
        }
        await unit.putRecord("users", record.id, record)
        return record
      })
    },

    updateUser(
      id: string,
      patch: Partial<Pick<UserRecord, "role" | "disabled" | "passwordHash">>,
    ): Promise<UserRecord> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        const existing = usersOf(await unit.loadAll())[id]
        if (!existing) throw new UsersError("not-found", `用户不存在: ${id}`)
        const updated: UserRecord = { ...existing, ...patch }
        await unit.putRecord("users", id, updated)
        return updated
      })
    },

    deleteUser(id: string): Promise<void> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        const snapshot = await unit.loadAll()
        if (!usersOf(snapshot)[id]) throw new UsersError("not-found", `用户不存在: ${id}`)
        await unit.deleteRecord("users", id)
        for (const s of Object.values(sessionsOf(snapshot))) {
          if (s.userId === id) await unit.deleteRecord("sessions", s.id)
        }
      })
    },

    async countActiveAdmins(): Promise<number> {
      const users = usersOf(await (await ensureOpen()).loadAll())
      return Object.values(users).filter((u) => u.role === "admin" && !u.disabled).length
    },

    async getSession(id: string): Promise<SessionRecord | null> {
      const record = sessionsOf(await (await ensureOpen()).loadAll())[id]
      if (!record) return null
      if (record.expiresAt <= Date.now()) {
        await chain.run(async () => {
          await (await ensureOpen()).deleteRecord("sessions", id)
        })
        return null
      }
      return record
    },

    putSession(record: SessionRecord): Promise<void> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        await unit.putRecord("sessions", record.id, record)
        const mine = Object.values(sessionsOf(await unit.loadAll()))
          .filter((s) => s.userId === record.userId)
          .sort((a, b) => a.createdAt - b.createdAt)
        let excess = mine.length - MAX_SESSIONS_PER_USER
        for (const s of mine) {
          if (excess <= 0) break
          await unit.deleteRecord("sessions", s.id)
          excess -= 1
        }
      })
    },

    deleteSession(id: string): Promise<void> {
      return chain.run(async () => {
        await (await ensureOpen()).deleteRecord("sessions", id)
      })
    },

    deleteExpiredSessions(now: number): Promise<number> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        let removed = 0
        for (const s of Object.values(sessionsOf(await unit.loadAll()))) {
          if (s.expiresAt <= now) {
            await unit.deleteRecord("sessions", s.id)
            removed += 1
          }
        }
        return removed
      })
    },

    deleteUserSessions(userId: string): Promise<number> {
      return chain.run(async () => {
        const unit = await ensureOpen()
        let removed = 0
        for (const s of Object.values(sessionsOf(await unit.loadAll()))) {
          if (s.userId === userId) {
            await unit.deleteRecord("sessions", s.id)
            removed += 1
          }
        }
        return removed
      })
    },

    async close(): Promise<void> {
      closed = true
      if (unitPromise !== null) await (await unitPromise).close()
    },
  }

  return service as UsersService
}

export type { UsersService }
```

- [ ] **Step 5: 实现 `src/index.ts`（替换 Task 1 占位）**

```ts
import type { Context } from "@deepseek-ai/cordis"
import type { StorageBackend } from "@deepseek-ai/dsh-storage"
import { createUsersService, type UsersService } from "./service.js"
import { USERS_UNIT_DESCRIPTOR, openUsersUnit } from "./unit.js"
import { WriteChain } from "./write-chain.js"
import { UsersError } from "./types.js"

export { createUsersService, type UsersService }
export { USERS_UNIT_DESCRIPTOR, openUsersUnit }
export { WriteChain }
export { UsersError }
export type { SessionRecord, UserRecord, UsersErrorCode } from "./types.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    users: UsersService
  }
}

export const name = "octopus-users"
export const inject = ["storage"] as const

interface StorageLike {
  backend: { get(name: string): StorageBackend }
}

export function apply(ctx: Context) {
  const storage = (ctx as unknown as { storage: StorageLike }).storage
  const service = createUsersService(storage.backend.get("json"))
  ctx.provide("users", service)
  ctx.effect(() => () => {
    void service.close()
  })
}

export default { name, inject, apply }
```

- [ ] **Step 6: 运行通过 → Commit**

Run: `pnpm --filter octopus-users test` Expected: PASS

```bash
git add packages/octopus-users
git commit -m "feat(octopus-users): add users/sessions data service and cordis plugin"
```

---

### Task 3: octopus-auth 包骨架 —— errors / config / scrypt 哈希

**Files:**
- Create: `packages/octopus-auth/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `cordis.patch.yml`
- Create: `packages/octopus-auth/src/errors.ts`, `src/config.ts`, `src/hash.ts`
- Test: `packages/octopus-auth/src/hash.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // errors.ts
  export class HttpError extends Error { readonly statusCode: number; readonly code: string }  // name='HttpError', message 默认取 code
  export function isHttpError(error: unknown): error is HttpError
  export function httpError(statusCode: number, code: string, message?: string): HttpError
  // hash.ts
  export async function hashPassword(password: string): Promise<string>   // 'scrypt$16384$8$1$<32位hex盐>$<64位hex>'
  export async function verifyPassword(password: string, stored: string): Promise<boolean>  // 畸形串安全返回 false
  export const DUMMY_HASH: Promise<string>                                // 模块级预热，恒定工作量路径用
  // config.ts
  export interface AuthResolvedConfig { mode: 'single-user' | 'multi-user'; backend: string; secureCookie: boolean; sessionTtlDays: number; trustProxy: boolean; bootstrapAdmin?: { username: string; password: string } }
  export const DEFAULT_AUTH_CONFIG: AuthResolvedConfig                    // multi-user/json/false/7/false
  export const AuthConfigSchema                                           // schemastery object，键同上 + bootstrapAdmin 可选对象
  export function resolveAuthConfig(partial?: Partial<AuthResolvedConfig>): AuthResolvedConfig
  ```

- [ ] **Step 1: 包骨架文件**

`package.json`：
```json
{
  "name": "octopus-auth",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "import": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "octopus-users": "^0.1.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "octopus-users": "file:../octopus-users",
    "typescript": "^5.6.0",
    "vitest": "^4.1.8"
  },
  "dsh.bundle.patch": "./cordis.patch.yml"
}
```

`tsconfig*.json`/`vitest.config.ts` 从 quickstart 复制；`cordis.patch.yml` 用 `id/name: octopus-auth`。

`src/errors.ts`：
```ts
export class HttpError extends Error {
  readonly statusCode: number
  readonly code: string
  constructor(statusCode: number, code: string, message?: string) {
    super(message ?? code)
    this.name = "HttpError"
    this.statusCode = statusCode
    this.code = code
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError
}

export function httpError(statusCode: number, code: string, message?: string): HttpError {
  return new HttpError(statusCode, code, message)
}
```

`src/config.ts`：
```ts
import z from "@deepseek-ai/schemastery"

export interface AuthResolvedConfig {
  mode: "single-user" | "multi-user"
  backend: string
  secureCookie: boolean
  sessionTtlDays: number
  trustProxy: boolean
  bootstrapAdmin?: { username: string; password: string }
}

export const DEFAULT_AUTH_CONFIG: AuthResolvedConfig = {
  mode: "multi-user",
  backend: "json",
  secureCookie: false,
  sessionTtlDays: 7,
  trustProxy: false,
}

export const AuthConfigSchema = z.object({
  mode: z.union([z.literal("single-user"), z.literal("multi-user")]).default(DEFAULT_AUTH_CONFIG.mode),
  backend: z.string().default(DEFAULT_AUTH_CONFIG.backend),
  secureCookie: z.boolean().default(DEFAULT_AUTH_CONFIG.secureCookie),
  sessionTtlDays: z.number().min(1).default(DEFAULT_AUTH_CONFIG.sessionTtlDays),
  trustProxy: z.boolean().default(DEFAULT_AUTH_CONFIG.trustProxy),
  bootstrapAdmin: z.object({
    username: z.string(),
    password: z.string(),
  }).optional(),
})

export function resolveAuthConfig(partial: Partial<AuthResolvedConfig> = {}): AuthResolvedConfig {
  return { ...DEFAULT_AUTH_CONFIG, ...partial }
}
```

`src/hash.ts`：
```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const scryptAsync = promisify(scrypt)

export const SCRYPT_N = 16384
export const SCRYPT_R = 8
export const SCRYPT_P = 1
export const SCRYPT_KEYLEN = 32
export const SALT_LEN = 16

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })) as Buffer
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3])
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  try {
    const salt = Buffer.from(parts[4], "hex")
    const expected = Buffer.from(parts[5], "hex")
    const derived = (await scryptAsync(password, salt, expected.length, { N, r, p })) as Buffer
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** 用户不存在时也执行一次等价开销的校验，抹平响应时间差（防用户名枚举） */
export const DUMMY_HASH: Promise<string> = hashPassword("octopus-dummy-password-for-timing")
```

- [ ] **Step 2: 失败测试 `src/hash.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { DUMMY_HASH, hashPassword, verifyPassword } from "./hash.js"
import { resolveAuthConfig, DEFAULT_AUTH_CONFIG } from "./config.js"

describe("hashPassword/verifyPassword", () => {
  it("哈希带参数头且可校验", async () => {
    const stored = await hashPassword("s3cret-pass")
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    await expect(verifyPassword("s3cret-pass", stored)).resolves.toBe(true)
    await expect(verifyPassword("wrong-pass", stored)).resolves.toBe(false)
  })

  it("相同密码两次哈希产生不同盐", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"))
  })

  it("畸形存储串安全返回 false", async () => {
    await expect(verifyPassword("x", "garbage")).resolves.toBe(false)
    await expect(verifyPassword("x", "bcrypt$1$2$3$4$5")).resolves.toBe(false)
  })

  it("DUMMY_HASH 是可用哈希", async () => {
    await expect(verifyPassword("octopus-dummy-password-for-timing", await DUMMY_HASH)).resolves.toBe(true)
  })
})

describe("resolveAuthConfig", () => {
  it("默认值符合规范", () => {
    expect(resolveAuthConfig()).toEqual(DEFAULT_AUTH_CONFIG)
    expect(DEFAULT_AUTH_CONFIG.mode).toBe("multi-user")
    expect(DEFAULT_AUTH_CONFIG.sessionTtlDays).toBe(7)
  })
})
```

- [ ] **Step 3: 安装并运行**

Run: `pnpm install && pnpm --filter octopus-auth test`
Expected: PASS（5 个用例）

- [ ] **Step 4: Commit**

```bash
git add packages/octopus-auth pnpm-lock.yaml
git commit -m "feat(octopus-auth): add skeleton with http errors, auth config, and scrypt hashing"
```

---

### Task 4: octopus-auth 登录限速器

**Files:**
- Create: `packages/octopus-auth/src/rate-limit.ts`
- Test: `packages/octopus-auth/src/rate-limit.test.ts`

**Interfaces:**
- Consumes: Task 3 `httpError`。
- Produces:
  ```ts
  export interface RateLimitOptions { windowMs: number; maxFailures: number }
  export interface RateLimiter {
    assertAllowed(bucket: string): void      // 锁定期内抛 HttpError(429,'rate-limited')，message 含剩余秒数
    recordFailure(bucket: string): void      // 达阈值起锁定：指数退避(第 n 次超额失败锁 2^n 分钟封顶 64min)，与窗口剩余取大者至少 1 分钟
    recordSuccess(bucket: string): void      // 清零该桶
  }
  export function createRateLimiter(options: RateLimitOptions): RateLimiter
  ```

- [ ] **Step 1: 失败测试 `src/rate-limit.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRateLimiter } from "./rate-limit.js"
import { HttpError } from "./errors.js"

const OPTS = { windowMs: 15 * 60_000, maxFailures: 5 }

describe("createRateLimiter", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("阈值内允许尝试", () => {
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 4; i++) rl.recordFailure("ip1")
    expect(() => rl.assertAllowed("ip1")).not.toThrow()
  })

  it("第 5 次失败后锁定并抛 429", () => {
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 5; i++) rl.recordFailure("ip1")
    try {
      rl.assertAllowed("ip1")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError)
      expect((e as HttpError).statusCode).toBe(429)
      expect((e as HttpError).code).toBe("rate-limited")
    }
  })

  it("成功登录清零", () => {
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 5; i++) rl.recordFailure("ip1")
    rl.recordSuccess("ip1")
    expect(() => rl.assertAllowed("ip1")).not.toThrow()
  })

  it("不同桶互不影响", () => {
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 5; i++) rl.recordFailure("ip1")
    expect(() => rl.assertAllowed("ip2")).not.toThrow()
  })

  it("持续失败指数退避：解锁后立即再败则锁更久", () => {
    const start = Date.now()
    vi.setSystemTime(start)
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 5; i++) rl.recordFailure("ip1")
    vi.setSystemTime(start + OPTS.windowMs + 1)
    expect(() => rl.assertAllowed("ip1")).not.toThrow()
    rl.recordFailure("ip1")                                   // 第 6 次 → 约 2 分钟退避
    vi.setSystemTime(start + OPTS.windowMs + 1 + 60_000)
    expect(() => rl.assertAllowed("ip1")).toThrow(HttpError)
    vi.setSystemTime(start + OPTS.windowMs + 1 + 2 * 60_000)
    expect(() => rl.assertAllowed("ip1")).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus-auth test` Expected: FAIL（rate-limit 模块不存在）

- [ ] **Step 3: 实现 `src/rate-limit.ts`**

```ts
import { httpError } from "./errors.js"

export interface RateLimitOptions {
  windowMs: number
  maxFailures: number
}

interface BucketState {
  failures: number
  windowStart: number
  lockedUntil: number
}

const LOCK_CAP_MS = 64 * 60_000

export function createRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, BucketState>()

  function inWindow(s: BucketState): boolean {
    return Date.now() - s.windowStart < options.windowMs
  }

  return {
    assertAllowed(bucket: string): void {
      const s = buckets.get(bucket)
      if (!s) return
      if (Date.now() < s.lockedUntil) {
        const retryAfterSec = Math.ceil((s.lockedUntil - Date.now()) / 1000)
        throw httpError(429, "rate-limited", `尝试过于频繁，请 ${retryAfterSec} 秒后再试`)
      }
      if (!inWindow(s)) buckets.delete(bucket)
    },

    recordFailure(bucket: string): void {
      let s = buckets.get(bucket)
      if (!s || !inWindow(s)) {
        s = { failures: 0, windowStart: Date.now(), lockedUntil: 0 }
        buckets.set(bucket, s)
      }
      s.failures += 1
      if (s.failures >= options.maxFailures) {
        const extra = s.failures - options.maxFailures
        const backoffMs = Math.min(2 ** extra * 60_000, LOCK_CAP_MS)
        s.lockedUntil = Date.now() + backoffMs
      }
    },

    recordSuccess(bucket: string): void {
      buckets.delete(bucket)
    },
  }
}
```

- [ ] **Step 4: 运行通过 → Commit**

Run: `pnpm --filter octopus-auth test` Expected: PASS

```bash
git add packages/octopus-auth
git commit -m "feat(octopus-auth): add login rate limiter with exponential backoff"
```

---

### Task 5: octopus-auth 请求工具 + AuthService 核心

**Files:**
- Create: `packages/octopus-auth/src/request.ts`, `src/testing.ts`, `src/session.ts`
- Test: `packages/octopus-auth/src/request.test.ts`, `src/session.test.ts`

**Interfaces:**
- Consumes: Task 2 `UsersService`（peerDep 类型）、Task 3 `hash`/`errors`/`config`、Task 4 `rate-limit`。
- Produces:
  ```ts
  // request.ts
  export interface RequestLike {
    method?: string
    url?: string
    headers?: { cookie?: string; origin?: string; host?: string; "x-forwarded-for"?: string }
    socket?: { remoteAddress?: string }
  }   // 与 node:http IncomingMessage 结构兼容，测试可传普通对象
  export function parseCookies(header: string | undefined): Record<string, string>
  export function sessionCookieName(secure: boolean): string   // '__Host-octopus_session' | 'octopus_session'
  export function buildSetCookie(name: string, id: string, maxAgeSec: number, secure: boolean): string
    // `${name}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${n}` + secure 时追加 '; Secure'；永不含 Domain
  export function buildClearCookie(name: string): string       // `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  export function bucketKeyOf(req: RequestLike, trustProxy: boolean): string
    // trustProxy 且有 x-forwarded-for → 取首值；否则 socket.remoteAddress ?? 'unknown'
  export function assertSameOrigin(req: RequestLike): void     // POST/PATCH/PUT/DELETE：Origin 缺失/非法/与 Host 不一致 → HttpError(403)
  // session.ts
  export interface AuthUser { id: string; username: string; role: 'admin' | 'user' }
  export interface AuthSession { sessionId: string; user: AuthUser; expiresAt: number }
  export const SINGLE_USER_SESSION: AuthSession   // { sessionId:'', user:{id:'local',username:'local',role:'admin'}, expiresAt:+Infinity }
  export interface AuthService {
    resolveRequest(req: RequestLike): Promise<AuthSession | null>
    requireAuth(req: RequestLike): Promise<AuthSession>    // 未登录 throw HttpError(401,'unauthorized')
    requireAdmin(req: RequestLike): Promise<AuthSession>   // 非 admin throw HttpError(403,'forbidden')
    login(username: string, password: string, req: RequestLike): Promise<{ setCookie: string }>
      // single-user 模式 throw HttpError(400)；限速桶=bucketKeyOf；用户不存在走 DUMMY_HASH 恒定路径；
      // 失败/禁用均报 401 'unauthorized'（文案"用户名或密码错误"）并 recordFailure；成功 recordSuccess+签发+顺带 deleteExpiredSessions(now)
    logout(req: RequestLike): Promise<{ setCookie: string }>  // 删除会话记录并返回清除 cookie
    hashPassword(password: string): Promise<string>
    verifyPassword(password: string, stored: string): Promise<boolean>
  }
  export function createAuthService(options: {
    users: UsersService; config: AuthResolvedConfig; rateLimiter: RateLimiter
  }): AuthService
  // testing.ts（仅供测试导入）
  export function createFakeUsers(seed?: UserRecord[]): UsersService & { _users: Map<string, UserRecord>; _sessions: Map<string, SessionRecord> }
  export function createRes(): { calls: { status: number; headers: Record<string, string>; body: string }[]; writeHead(s: number, h?: Record<string,string>): void; end(b?: string | Uint8Array): void }
  ```

- [ ] **Step 1: 实现 `src/request.ts`**（纯工具，先写实现便于测试引用）

```ts
import { httpError } from "./errors.js"

export interface RequestLike {
  method?: string
  url?: string
  headers?: { cookie?: string; origin?: string; host?: string; "x-forwarded-for"?: string }
  socket?: { remoteAddress?: string }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=")
    if (idx <= 0) continue
    const key = pair.slice(0, idx).trim()
    try {
      out[key] = decodeURIComponent(pair.slice(idx + 1).trim())
    } catch {
      out[key] = pair.slice(idx + 1).trim()
    }
  }
  return out
}

export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-octopus_session" : "octopus_session"
}

export function buildSetCookie(name: string, id: string, maxAgeSec: number, secure: boolean): string {
  const parts = [`${name}=${id}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`]
  if (secure) parts.push("Secure")
  return parts.join("; ")
}

export function buildClearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function bucketKeyOf(req: RequestLike, trustProxy: boolean): string {
  const xff = req.headers?.["x-forwarded-for"]
  if (trustProxy && typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim()
  }
  return req.socket?.remoteAddress ?? "unknown"
}

/** CSRF 第二道防线：变更类请求必须携带与 Host 一致的 Origin（缺失即拒，严格模式） */
export function assertSameOrigin(req: RequestLike): void {
  const method = (req.method ?? "GET").toUpperCase()
  if (!MUTATING_METHODS.has(method)) return
  const origin = req.headers?.origin
  const host = req.headers?.host
  if (!origin || !host) throw httpError(403, "forbidden", "缺少 Origin 头")
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw httpError(403, "forbidden", "Origin 不合法")
  }
  if (originHost !== host) throw httpError(403, "forbidden", "Origin 与 Host 不匹配")
}
```

- [ ] **Step 2: 写失败测试 `src/request.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import {
  assertSameOrigin, bucketKeyOf, buildClearCookie, buildSetCookie,
  parseCookies, sessionCookieName,
} from "./request.js"
import { HttpError } from "./errors.js"

describe("parseCookies", () => {
  it("解析 cookie 头", () => {
    expect(parseCookies("a=1; octopus_session=xyz")).toEqual({ a: "1", octopus_session: "xyz" })
    expect(parseCookies(undefined)).toEqual({})
  })
})

describe("cookie 构造", () => {
  it("名称随 secure 切换且永不携带 Domain", () => {
    expect(sessionCookieName(false)).toBe("octopus_session")
    expect(sessionCookieName(true)).toBe("__Host-octopus_session")
    const c = buildSetCookie("__Host-octopus_session", "id1", 3600, true)
    expect(c).toContain("HttpOnly")
    expect(c).toContain("SameSite=Lax")
    expect(c).toContain("Path=/")
    expect(c).toContain("Secure")
    expect(c).not.toContain("Domain")
    expect(buildClearCookie("octopus_session")).toBe(
      "octopus_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    )
  })
})

describe("bucketKeyOf", () => {
  it("默认取 socket 地址（反代下退化为全局桶）", () => {
    expect(bucketKeyOf({ socket: { remoteAddress: "127.0.0.1" } }, false)).toBe("127.0.0.1")
    expect(bucketKeyOf({}, false)).toBe("unknown")
  })
  it("trustProxy 时优先 XFF 首值", () => {
    const req = { socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }
    expect(bucketKeyOf(req, true)).toBe("9.9.9.9")
    expect(bucketKeyOf({ headers: {} }, true)).toBe("unknown")
  })
})

describe("assertSameOrigin", () => {
  it("GET 放行", () => expect(() => assertSameOrigin({ method: "GET" })).not.toThrow())
  it("变更请求缺 Origin 抛 403", () => expect(() => assertSameOrigin({ method: "POST" })).toThrow(HttpError))
  it("跨域 Origin 抛 403", () => {
    expect(() => assertSameOrigin({
      method: "POST", headers: { origin: "https://evil.com", host: "wb.example.com" },
    })).toThrow(HttpError)
  })
  it("同源放行（scheme 不限）", () => {
    expect(() => assertSameOrigin({
      method: "DELETE", headers: { origin: "http://wb.example.com", host: "wb.example.com" },
    })).not.toThrow()
    expect(() => assertSameOrigin({
      method: "PATCH", headers: { origin: "https://wb.example.com", host: "wb.example.com" },
    })).not.toThrow()
  })
})
```

- [ ] **Step 3: 实现共享测试设施 `src/testing.ts`**

```ts
import type { SessionRecord, UserRecord, UsersService } from "octopus-users"

function codeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(`[octopus-users] ${message}`), { code })
}

export function createFakeUsers(seed: UserRecord[] = []): UsersService & {
  _users: Map<string, UserRecord>
  _sessions: Map<string, SessionRecord>
} {
  const users = new Map(seed.map((u) => [u.id, u]))
  const sessions = new Map<string, SessionRecord>()
  return {
    _users: users,
    _sessions: sessions,

    async findByUsername(username) {
      const wanted = username.trim().toLowerCase()
      return [...users.values()].find((u) => u.username.toLowerCase() === wanted) ?? null
    },
    async getUser(id) { return users.get(id) ?? null },
    async listUsers() { return [...users.values()].sort((a, b) => a.createdAt - b.createdAt) },

    async createUser(input) {
      const trimmed = input.username.trim()
      if (!trimmed || /\s/.test(trimmed)) throw codeError("invalid", "用户名非法")
      const dup = [...users.values()].some((u) => u.username.toLowerCase() === trimmed.toLowerCase())
      if (dup) throw codeError("conflict", "用户名已存在")
      const rec: UserRecord = {
        id: crypto.randomUUID(), username: trimmed, passwordHash: input.passwordHash,
        role: input.role, disabled: false, createdAt: Date.now(),
      }
      users.set(rec.id, rec)
      return rec
    },

    async updateUser(id, patch) {
      const existing = users.get(id)
      if (!existing) throw codeError("not-found", "用户不存在")
      const updated = { ...existing, ...patch }
      users.set(id, updated)
      return updated
    },

    async deleteUser(id) {
      if (!users.has(id)) throw codeError("not-found", "用户不存在")
      users.delete(id)
      for (const [k, s] of sessions) if (s.userId === id) sessions.delete(k)
    },

    async countActiveAdmins() {
      return [...users.values()].filter((u) => u.role === "admin" && !u.disabled).length
    },

    async getSession(id) {
      const s = sessions.get(id)
      if (!s) return null
      if (s.expiresAt <= Date.now()) { sessions.delete(id); return null }
      return s
    },
    async putSession(rec) { sessions.set(rec.id, rec) },
    async deleteSession(id) { sessions.delete(id) },

    async deleteExpiredSessions(now) {
      let n = 0
      for (const [k, s] of sessions) if (s.expiresAt <= now) { sessions.delete(k); n += 1 }
      return n
    },
    async deleteUserSessions(userId) {
      let n = 0
      for (const [k, s] of sessions) if (s.userId === userId) { sessions.delete(k); n += 1 }
      return n
    },

    async close() {},
  }
}

export function createRes() {
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
```

- [ ] **Step 4: 写失败测试 `src/session.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest"
import { createAuthService, SINGLE_USER_SESSION, type AuthService } from "./session.js"
import { createFakeUsers } from "./testing.js"
import { hashPassword } from "./hash.js"
import type { AuthResolvedConfig } from "./config.js"

const BASE: AuthResolvedConfig = {
  mode: "multi-user", backend: "json", secureCookie: false, sessionTtlDays: 7, trustProxy: false,
}
const PASS_THROUGH_LIMITER = { assertAllowed: () => {}, recordFailure: () => {}, recordSuccess: () => {} }
const LOGIN_REQ = { method: "POST", headers: { origin: "http://x", host: "x" }, socket: { remoteAddress: "t" } }

function cookieIdOf(setCookie: string, name = "octopus_session") {
  return setCookie.split(";")[0]!.slice(name.length + 1)
}

describe("createAuthService（multi-user）", () => {
  let auth: AuthService

  beforeEach(async () => {
    const users = createFakeUsers()
    await users.createUser({ username: "alice", passwordHash: await hashPassword("passw0rd!"), role: "admin" })
    auth = createAuthService({ users, config: BASE, rateLimiter: PASS_THROUGH_LIMITER })
  })

  it("登录签发 cookie 并解析回会话", async () => {
    const { setCookie } = await auth.login("alice", "passw0rd!", LOGIN_REQ)
    expect(setCookie).toContain("octopus_session=")
    const id = cookieIdOf(setCookie)
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/) // randomBytes(32) base64url
    const resolved = await auth.resolveRequest({ headers: { cookie: `octopus_session=${id}` } })
    expect(resolved!.user).toMatchObject({ username: "alice", role: "admin" })
  })

  it("错误密码与不存在用户均抛 401", async () => {
    await expect(auth.login("alice", "wrong-pass!", LOGIN_REQ)).rejects.toMatchObject({ statusCode: 401 })
    await expect(auth.login("ghost", "whatever123", LOGIN_REQ)).rejects.toMatchObject({ statusCode: 401 })
  })

  it("禁用用户即使持有效会话也被拒", async () => {
    const { setCookie } = await auth.login("alice", "passw0rd!", LOGIN_REQ)
    const id = cookieIdOf(setCookie)
    const users = (auth as unknown as { users: ReturnType<typeof createFakeUsers> }).users
    const alice = await users.findByUsername("alice")
    await users.updateUser(alice!.id, { disabled: true })
    await expect(auth.resolveRequest({ headers: { cookie: `octopus_session=${id}` } })).resolves.toBeNull()
  })

  it("过期会话返回 null（fake 的惰性删除路径）", async () => {
    vi.useFakeTimers()
    const { setCookie } = await auth.login("alice", "passw0rd!", LOGIN_REQ)
    const id = cookieIdOf(setCookie)
    vi.setSystemTime(Date.now() + 8 * 24 * 3600_000)
    await expect(auth.resolveRequest({ headers: { cookie: `octopus_session=${id}` } })).resolves.toBeNull()
    vi.useRealTimers()
  })

  it("登出后会话立即失效", async () => {
    const { setCookie } = await auth.login("alice", "passw0rd!", LOGIN_REQ)
    const id = cookieIdOf(setCookie)
    const header = `octopus_session=${id}`
    const { setCookie: cleared } = await auth.logout({ headers: { cookie: header } })
    expect(cleared).toBe("octopus_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
    await expect(auth.resolveRequest({ headers: { cookie: header } })).resolves.toBeNull()
  })

  it("requireAuth 未登录 401；requireAdmin 非 admin 403", async () => {
    await expect(auth.requireAuth({})).rejects.toMatchObject({ statusCode: 401 })
    const users = createFakeUsers()
    const bob = await users.createUser({ username: "bob", passwordHash: await hashPassword("passw0rd!"), role: "user" })
    const plainAuth = createAuthService({
      users, config: BASE,
      rateLimiter: {
        assertAllowed: () => {}, recordFailure: () => {}, recordSuccess: () => {},
      },
    })
    const { setCookie } = await plainAuth.login("bob", "passw0rd!", LOGIN_REQ)
    const header = { cookie: `octopus_session=${cookieIdOf(setCookie)}` }
    await expect(plainAuth.requireAuth(header)).resolves.toMatchObject({ user: { username: "bob" } })
    await expect(plainAuth.requireAdmin(header)).rejects.toMatchObject({ statusCode: 403 })
    void bob
  })
})

describe("single-user 模式", () => {
  it("一切请求视为虚拟管理员，login 返回 400", async () => {
    const auth = createAuthService({
      users: createFakeUsers(), config: { ...BASE, mode: "single-user" }, rateLimiter: PASS_THROUGH_LIMITER,
    })
    await expect(auth.requireAdmin({})).resolves.toBe(SINGLE_USER_SESSION)
    await expect(auth.resolveRequest({ headers: {} })).resolves.toBe(SINGLE_USER_SESSION)
    await expect(auth.login("a", "b", {})).rejects.toMatchObject({ statusCode: 400 })
  })
})
```

> 注意：`beforeEach` 里通过 `(auth as any).users` 拿回服务引用是为测试便利；实现上 `createAuthService` 返回的对象挂一个非契约属性 `readonly users` 即可（TS 用符号或直接公开字段均可），或者改用闭包内先建 `users` 再传入——两种都行，落地时保持测试能拿到同一实例。

- [ ] **Step 5: 运行确认失败**

Run: `pnpm --filter octopus-auth test` Expected: FAIL（session.js 不存在）

- [ ] **Step 6: 实现 `src/session.ts`**

```ts
import { randomBytes } from "node:crypto"
import type { UsersService } from "octopus-users"
import { httpError } from "./errors.js"
import { DUMMY_HASH, verifyPassword, hashPassword } from "./hash.js"
import {
  bucketKeyOf, buildClearCookie, buildSetCookie, parseCookies, sessionCookieName,
  type RequestLike,
} from "./request.js"
import type { AuthResolvedConfig } from "./config.js"
import type { RateLimiter } from "./rate-limit.js"

export interface AuthUser {
  id: string
  username: string
  role: "admin" | "user"
}

export interface AuthSession {
  sessionId: string
  user: AuthUser
  expiresAt: number
}

export const SINGLE_USER_SESSION: AuthSession = {
  sessionId: "",
  user: { id: "local", username: "local", role: "admin" },
  expiresAt: Number.POSITIVE_INFINITY,
}

export interface AuthService {
  resolveRequest(req: RequestLike): Promise<AuthSession | null>
  requireAuth(req: RequestLike): Promise<AuthSession>
  requireAdmin(req: RequestLike): Promise<AuthSession>
  login(username: string, password: string, req: RequestLike): Promise<{ setCookie: string }>
  logout(req: RequestLike): Promise<{ setCookie: string }>
  hashPassword(password: string): Promise<string>
  verifyPassword(password: string, stored: string): Promise<boolean>
}

function toAuthUser(u: { id: string; username: string; role: "admin" | "user" }) {
  return { id: u.id, username: u.username, role: u.role }
}

export function createAuthService(options: {
  users: UsersService
  config: AuthResolvedConfig
  rateLimiter: RateLimiter
}): AuthService {
  const { users, config, rateLimiter } = options
  const ttlMs = config.sessionTtlDays * 24 * 3600_000
  const cookieName = sessionCookieName(config.secureCookie)

  async function resolveByCookie(cookieHeader: string | undefined): Promise<AuthSession | null> {
    const id = parseCookies(cookieHeader)[cookieName]
    if (!id) return null
    const record = await users.getSession(id)
    if (!record) return null
    const user = await users.getUser(record.userId)
    if (!user || user.disabled) return null
    return { sessionId: id, user: toAuthUser(user), expiresAt: record.expiresAt }
  }

  return {
    users,

    async resolveRequest(req) {
      if (config.mode === "single-user") return SINGLE_USER_SESSION
      return resolveByCookie(req.headers?.cookie)
    },

    async requireAuth(req) {
      const session = await this.resolveRequest(req)
      if (!session) throw httpError(401, "unauthorized", "未登录")
      return session
    },

    async requireAdmin(req) {
      const session = await this.requireAuth(req)
      if (session.user.role !== "admin") throw httpError(403, "forbidden", "需要管理员权限")
      return session
    },

    async login(username, password, req) {
      if (config.mode === "single-user") {
        throw httpError(400, "single-user", "当前为 single-user 模式，无需登录")
      }
      const bucket = bucketKeyOf(req, config.trustProxy)
      rateLimiter.assertAllowed(bucket)
      const user = await users.findByUsername(username)
      let ok = false
      if (user) ok = await verifyPassword(password, user.passwordHash)
      else await verifyPassword(password, await DUMMY_HASH) // 恒定工作量路径
      if (!ok || !user || user.disabled) {
        rateLimiter.recordFailure(bucket)
        throw httpError(401, "unauthorized", "用户名或密码错误")
      }
      rateLimiter.recordSuccess(bucket)
      const now = Date.now()
      const sessionId = randomBytes(32).toString("base64url")
      await users.putSession({ id: sessionId, userId: user.id, createdAt: now, expiresAt: now + ttlMs })
      void users.deleteExpiredSessions(now).catch(() => undefined)
      return { setCookie: buildSetCookie(cookieName, sessionId, Math.floor(ttlMs / 1000), config.secureCookie) }
    },

    async logout(req) {
      const id = parseCookies(req.headers?.cookie)[cookieName]
      if (id) await users.deleteSession(id)
      return { setCookie: buildClearCookie(cookieName) }
    },

    hashPassword,
    verifyPassword,
  }
}
```

> 注：logout 直接返回 `buildClearCookie(cookieName)`，session 层复用 request.js 的统一清除格式；Step 4 测试断言已与此对齐。

- [ ] **Step 7: 运行通过 → Commit**

Run: `pnpm --filter octopus-auth test` Expected: PASS

```bash
git add packages/octopus-auth
git commit -m "feat(octopus-auth): add request utils and auth service with sessions and modes"
```

---

### Task 6: octopus-auth 登录页 + 插件装配（全部端点）

**Files:**
- Create: `packages/octopus-auth/src/body.ts`, `src/login-page.ts`
- Modify: `packages/octopus-auth/src/index.ts`（替换 Task 3 骨架占位为正式插件入口）
- Test: `packages/octopus-auth/src/login-page.test.ts`, `src/index.test.ts`

**Interfaces:**
- Consumes: Task 2-5 全部导出。
- Produces:
  ```ts
  // body.ts
  export async function parseBody(req: IncomingMessage, bodyText?: string): Promise<unknown>
    // bodyText 存在则 JSON.parse（失败→400 bad-request）；否则按流读取，上限 64KB（超限→413）、空体→400、非法 JSON→400
  // login-page.ts
  export function renderLoginPage(options: { needsSetup: boolean }): string
    // 单文件 HTML：无外部 src/href 引用；redirect 参数同源相对校验 /^\/(?!\/)/；needsSetup 渲染初始化提示
  // index.ts（最终对外契约）
  export const name: "octopus-auth"; export const inject: ["webServer", "users"]
  export const Config: typeof AuthConfigSchema
  export { isHttpError, resolveAuthConfig, createAuthService, SINGLE_USER_SESSION, createUsersService }
  export type { AuthResolvedConfig, AuthService, AuthSession, AuthUser }
  declare module "@deepseek-ai/cordis" { interface Context { auth: AuthService } }
  ```
- 注册路由（exact）：`GET /login`、`POST /api/octopus-auth/login`、`POST /api/octopus-auth/logout`、`GET /api/octopus-auth/me`、`GET /api/octopus-auth/verify`、`GET|POST /api/octopus-auth/users`；（prefix）`PATCH|DELETE /api/octopus-auth/users/:id`。
- 行为约定：所有 handler 为 `(req: IncomingMessage, res: ServerResponse, bodyText?: string) => Promise<void>`（第三参仅测试注入用）；HttpError→对应状态码 JSON `{error,message}`；UsersError→invalid/not-found→400/404、conflict→409；未知异常原样 rethrow（webserver 兜底记日志）。`/me` 响应 `{user, canLogout}`（single-user 下 canLogout=false）。`/verify` 有会话 204 无体、否则 401。管理端点自我保护：对自己 disabled=true 或 DELETE → 400 self-operation；降级/禁用/删除最后一个可用 admin → 400 last-admin。创建用户密码 <8 位 → 400 weak-password。bootstrap：multi-user 激活时若用户表空且有 bootstrapAdmin 配置 → 创建 admin 并记 info 日志；空且无配置 → 仅 warn。

- [ ] **Step 1: 实现 `src/body.ts`**

```ts
import type { IncomingMessage } from "node:http"
import { httpError } from "./errors.js"

const MAX_BODY_BYTES = 64 * 1024

export async function parseBody(req: IncomingMessage, bodyText?: string): Promise<unknown> {
  if (typeof bodyText === "string") {
    try {
      return JSON.parse(bodyText)
    } catch {
      throw httpError(400, "bad-request", "请求体不是合法 JSON")
    }
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > MAX_BODY_BYTES) throw httpError(413, "payload-too-large", "请求体过大")
    chunks.push(chunk as Buffer)
  }
  if (total === 0) throw httpError(400, "bad-request", "请求体不能为空")
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw httpError(400, "bad-request", "请求体不是合法 JSON")
  }
}
```

- [ ] **Step 2: 失败测试 `src/login-page.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { renderLoginPage } from "./login-page.js"

describe("renderLoginPage", () => {
  const html = renderLoginPage({ needsSetup: false })

  it("单文件：无任何外部资源引用", () => {
    expect(html).toContain("<form")
    expect(html).toContain("<script>")
    expect(html.toLowerCase()).not.toContain("src=")
    expect(html.toLowerCase()).not.toContain("href=")
  })

  it("redirect 参数做同源相对路径校验", () => {
    expect(html).toContain("/^\\/(?!\\/)/")
  })

  it("needsSetup 时显示初始化提示", () => {
    expect(renderLoginPage({ needsSetup: true })).toContain("尚未配置初始管理员")
    expect(html).not.toContain("尚未配置初始管理员")
  })
})
```

- [ ] **Step 3: 实现 `src/login-page.ts`**（模板字符串，无用户输入插值 → 无 XSS 面）

```ts
export function renderLoginPage(options: { needsSetup: boolean }): string {
  const setupNotice = options.needsSetup
    ? `<div class="notice">尚未配置初始管理员：请在 dsh profile 配置中设置 octopus-auth.bootstrapAdmin 后重启。</div>`
    : ""
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 · 工作台</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f5f6f8; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  .card { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); width: 320px; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  label { display: block; font-size: .85rem; color: #555; margin: .75rem 0 .25rem; }
  input { width: 100%; box-sizing: border-box; padding: .5rem; border: 1px solid #ccc; border-radius: 6px; }
  button { margin-top: 1rem; width: 100%; padding: .55rem; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
  .error { color: #dc2626; font-size: .85rem; margin-top: .75rem; min-height: 1.2em; }
  .notice { color: #b45309; font-size: .85rem; margin-bottom: 1rem; }
</style>
</head>
<body>
<div class="card">
  <h1>工作台登录</h1>
  ${setupNotice}
  <form id="login-form">
    <label for="username">用户名</label>
    <input id="username" name="username" autocomplete="username" required>
    <label for="password">密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">登 录</button>
    <div class="error" id="error"></div>
  </form>
</div>
<script>
(function () {
  var form = document.getElementById("login-form");
  var errorEl = document.getElementById("error");
  var params = new URLSearchParams(location.search);
  var rawRedirect = params.get("redirect") || "/workbench";
  var redirect = /^\\/(?!\\/)/.test(rawRedirect) ? rawRedirect : "/workbench";
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorEl.textContent = "";
    fetch("/api/octopus-auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value
      })
    }).then(function (res) {
      if (res.ok) { location.href = redirect; return; }
      return res.json().then(function (data) {
        errorEl.textContent = data.error === "rate-limited"
          ? (data.message || "尝试过于频繁，请稍后再试")
          : "用户名或密码错误";
      });
    }).catch(function () { errorEl.textContent = "网络错误，请重试"; });
  });
})();
</script>
</body>
</html>`
}
```

- [ ] **Step 4: 失败测试 `src/index.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest"
import { apply, resolveAuthConfig } from "./index.js"
import { createFakeUsers, createRes } from "./testing.js"
import { hashPassword } from "./hash.js"

function setup(partial: Parameters<typeof resolveAuthConfig>[0] = {}) {
  const register = vi.fn(() => vi.fn())
  const users = createFakeUsers()
  const ctx: any = {
    webServer: { register },
    users,
    effect: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn() },
  }
  apply(ctx, partial)
  const routes = new Map(register.mock.calls.map((c: any[]) => [`${c[0].kind} ${c[0].path}`, c[0]]))
  return { ctx, users, routes }
}

async function seedAdmin(users: ReturnType<typeof createFakeUsers>) {
  await users.createUser({ username: "boss", passwordHash: "", role: "admin" })
  const boss = (await users.findByUsername("boss"))!
  await users.updateUser(boss.id, { passwordHash: await hashPassword("passw0rd!") })
}

describe("octopus-auth apply", () => {
  it("注册预期路由并提供 auth 服务", () => {
    const { ctx, routes } = setup()
    expect(ctx.provide).toHaveBeenCalledWith("auth", expect.objectContaining({
      requireAuth: expect.any(Function),
      requireAdmin: expect.any(Function),
    }))
    expect([...routes.keys()].sort()).toEqual([
      "exact /api/octopus-auth/login",
      "exact /api/octopus-auth/logout",
      "exact /api/octopus-auth/me",
      "exact /api/octopus-auth/verify",
      "exact /api/octopus-auth/users",
      "exact /login",
      "prefix /api/octopus-auth/users/",
    ].sort())
  })

  it("verify：无会话 401", async () => {
    const { routes } = setup()
    const res = createRes()
    await routes.get("exact /api/octopus-auth/verify")!.handler({ method: "GET", headers: {} }, res)
    expect(res.calls[0].status).toBe(401)
  })

  it("登录页公开且 needsSetup 动态渲染", async () => {
    const { users, routes } = setup()
    const emptyRes = createRes()
    await routes.get("exact /login")!.handler({ method: "GET", headers: {} }, emptyRes)
    expect(emptyRes.calls[0].status).toBe(200)
    expect(emptyRes.calls[0].body).toContain("尚未配置初始管理员")
    await seedAdmin(users)
    const readyRes = createRes()
    await routes.get("exact /login")!.handler({ method: "GET", headers: {} }, readyRes)
    expect(readyRes.calls[0].body).not.toContain("尚未配置初始管理员")
  })

  it("登录成功 Set-Cookie；me 返回用户与 canLogout=true", async () => {
    const { users, routes } = setup()
    await seedAdmin(users)
    const loginRes = createRes()
    await routes.get("exact /api/octopus-auth/login")!.handler(
      {
        method: "POST", url: "/api/octopus-auth/login",
        headers: { origin: "http://localhost", host: "localhost" },
        socket: { remoteAddress: "ip-a" },
      } as any, loginRes,
      JSON.stringify({ username: "boss", password: "passw0rd!" }),
    )
    expect(loginRes.calls[0].status).toBe(200)
    const cookie = loginRes.calls[0].headers["set-cookie"]!
    expect(cookie).toMatch(/^octopus_session=[A-Za-z0-9_-]+/)
    const meRes = createRes()
    await routes.get("exact /api/octopus-auth/me")!.handler(
      { method: "GET", headers: { cookie } } as any, meRes,
    )
    const body = JSON.parse(meRes.calls[0].body)
    expect(body.user.username).toBe("boss")
    expect(body.canLogout).toBe(true)
  })

  it("single-user：me 直通且 canLogout=false，login 返回 400", async () => {
    const { routes } = setup({ mode: "single-user" })
    const meRes = createRes()
    await routes.get("exact /api/octopus-auth/me")!.handler({ method: "GET", headers: {} } as any, meRes)
    const body = JSON.parse(meRes.calls[0].body)
    expect(body.user.username).toBe("local")
    expect(body.canLogout).toBe(false)
    const loginRes = createRes()
    await routes.get("exact /api/octopus-auth/login")!.handler(
      { method: "POST", url: "/x", headers: { origin: "http://h", host: "h" } } as any, loginRes,
      JSON.stringify({ username: "a", password: "b" }),
    )
    expect(loginRes.calls[0].status).toBe(400)
  })

  it("bootstrap：空表 + bootstrapAdmin 配置自动建号", async () => {
    const register = vi.fn(() => vi.fn())
    const users = createFakeUsers()
    const ctx: any = {
      webServer: { register }, users,
      effect: vi.fn(), logger: { info: vi.fn(), warn: vi.fn() },
    }
    apply(ctx, { bootstrapAdmin: { username: "founder", password: "founder-pass1" } })
    await vi.waitFor(async () => {
      const found = await users.findByUsername("founder")
      if (!found) throw new Error("not yet")
      expect(found.role).toBe("admin")
    })
  })
})
```

- [ ] **Step 5: 实现 `src/index.ts`（正式插件入口）**

```ts
import type { Context } from "@deepseek-ai/cordis"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { UserRecord, UsersService } from "octopus-users"
import { UsersError } from "octopus-users"
import { AuthConfigSchema, resolveAuthConfig, type AuthResolvedConfig } from "./config.js"
import { httpError, isHttpError } from "./errors.js"
import { parseBody } from "./body.js"
import { hashPassword } from "./hash.js"
import { createRateLimiter } from "./rate-limit.js"
import {
  assertSameOrigin, buildClearCookie, parseCookies, sessionCookieName,
} from "./request.js"
import { createAuthService, type AuthResolvedConfig as _A, type AuthService, type AuthSession } from "./session.js"

export { isHttpError, httpError } from "./errors.js"
export { resolveAuthConfig, AuthConfigSchema } from "./config.js"
export type { AuthResolvedConfig } from "./config.js"
export { createAuthService, SINGLE_USER_SESSION } from "./session.js"
export type { AuthService, AuthSession, AuthUser } from "./session.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    auth: AuthService
  }
}

export const name = "octopus-auth"
export const inject = ["webServer", "users"] as const
export const Config = AuthConfigSchema

type Json = Record<string, unknown>

type Handler = (req: IncomingMessage, res: ServerResponse, bodyText?: string) => Promise<void>

function sendJson(res: ServerResponse, status: number, body: Json, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...extraHeaders })
  res.end(JSON.stringify(body))
}

function handleError(res: ServerResponse, error: unknown) {
  if (isHttpError(error)) {
    sendJson(res, error.statusCode, { error: error.code, message: error.message })
    return
  }
  if (error instanceof UsersError) {
    const status = error.code === "conflict" ? 409 : error.code === "not-found" ? 404 : 400
    sendJson(res, status, { error: error.code, message: error.message })
    return
  }
  throw error
}

function requireField(body: unknown, field: string): string {
  const value = (body as Json)?.[field]
  if (typeof value !== "string" || value.length === 0) throw httpError(400, "bad-request", `缺少字段 ${field}`)
  return value
}

function assertPasswordStrength(password: string) {
  if (password.length < 8) throw httpError(400, "weak-password", "密码至少 8 位")
}

function sanitizeUser(u: UserRecord) {
  return { id: u.id, username: u.username, role: u.role, disabled: u.disabled, createdAt: u.createdAt }
}

export function apply(ctx: Context, partialConfig: Partial<AuthResolvedConfig> = {}) {
  const config = resolveAuthConfig(partialConfig)
  const users = (ctx as unknown as { users: UsersService }).users
  const authService = createAuthService({
    users, config,
    rateLimiter: createRateLimiter({ windowMs: 15 * 60_000, maxFailures: 5 }),
  })
  ctx.provide("auth", authService)

  const secure = config.secureCookie
  const cookieName = sessionCookieName(secure)
  const USERS_PREFIX = "/api/octopus-auth/users/"

  function assertNotSelf(session: AuthSession, targetId: string) {
    if (session.user.id === targetId) throw httpError(400, "self-operation", "不能对自己执行该操作")
  }

  async function assertNotLastAdmin(targetId: string, demoteOrDisable: boolean) {
    const target = await users.getUser(targetId)
    if (!target || target.role !== "admin" || target.disabled) return
    const activeAdmins = await users.countActiveAdmins()
    if (activeAdmins <= 1 && demoteOrDisable) {
      throw httpError(400, "last-admin", "不能移除最后一个可用管理员")
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: "exact",
        path: "/login",
        handler: async (_req, res) => {
          let needsSetup = false
          if (config.mode === "multi-user") needsSetup = (await users.listUsers()).length === 0
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
          res.end(require("./login-page").renderLoginPage({ needsSetup }))
        },
      }),
      ctx.webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/login",
        handler: async (req, res, bodyText) => {
          try {
            assertSameOrigin(req)
            const body = await parseBody(req, bodyText)
            const { setCookie } = await authService.login(
              requireField(body, "username"), requireField(body, "password"), req,
            )
            sendJson(res, 200, { ok: true }, { "set-cookie": setCookie })
          } catch (error) { handleError(res, error) }
        },
      }),
      ctx.webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/logout",
        handler: async (req, res) => {
          try {
            await authService.requireAuth(req)
            const { setCookie } = await authService.logout(req)
            sendJson(res, 200, { ok: true }, { "set-cookie": setCookie })
          } catch (error) { handleError(res, error) }
        },
      }),
      ctx.webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/me",
        handler: async (req, res) => {
          try {
            const session = await authService.requireAuth(req)
            sendJson(res, 200, {
              user: session.user,
              canLogout: config.mode !== "single-user",
            })
          } catch (error) { handleError(res, error) }
        },
      }),
      ctx.webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/verify",
        handler: async (req, res) => {
          const session = await authService.resolveRequest(req)
          res.writeHead(session ? 204 : 401)
          res.end()
        },
      }),
      ctx.webServer.register({
        kind: "exact",
        path: "/api/octopus-auth/users",
        handler: async (req, res, bodyText) => {
          try {
            await authService.requireAdmin(req)
            assertSameOrigin(req)
            if ((req.method ?? "GET").toUpperCase() === "GET") {
              sendJson(res, 200, { users: (await users.listUsers()).map(sanitizeUser) })
              return
            }
            const body = (await parseBody(req, bodyText)) as Json
            const rawPassword = requireField(body, "password")
            assertPasswordStrength(rawPassword)
            const created = await users.createUser({
              username: requireField(body, "username"),
              role: body.role === "admin" ? "admin" : "user",
              passwordHash: await hashPassword(rawPassword),
            })
            sendJson(res, 201, { user: sanitizeUser(created) })
          } catch (error) { handleError(res, error) }
        },
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: USERS_PREFIX,
        handler: async (req, res, bodyText) => {
          try {
            const session = await authService.requireAdmin(req)
            assertSameOrigin(req)
            const id = decodeURIComponent((req.url ?? "").slice(USERS_PREFIX.length).split("?")[0])
            if (!id) throw httpError(404, "not-found", "缺少用户 id")
            const method = (req.method ?? "GET").toUpperCase()

            if (method === "DELETE") {
              assertNotSelf(session, id)
              await assertNotLastAdmin(id, true)
              await users.deleteUser(id)
              sendJson(res, 200, { ok: true })
              return
            }
            if (method === "PATCH") {
              const body = (await parseBody(req, bodyText)) as Json
              const patch: Record<string, unknown> = {}
              if (typeof body.password === "string") {
                assertPasswordStrength(body.password)
                patch.passwordHash = await hashPassword(body.password)
              }
              if (typeof body.role === "string") {
                if (body.role !== "admin" && body.role !== "user") throw httpError(400, "bad-request", "role 非法")
                patch.role = body.role
              }
              if (typeof body.disabled === "boolean") patch.disabled = body.disabled
              if (Object.keys(patch).length === 0) throw httpError(400, "bad-request", "无可应用字段")

              const willDemote = patch.role === "user"
              const willDisable = patch.disabled === true
              if (willDisable && session.user.id === id) throw httpError(400, "self-operation", "不能禁用自己")
              if ((willDemote || willDisable) && !willDemote) {
                await assertNotLastAdmin(id, willDemote || willDisable)
              } else if (willDemote) {
                await assertNotLastAdmin(id, true)
              }
              const updated = await users.updateUser(id, patch as Partial<UserRecord>)
              sendJson(res, 200, { user: sanitizeUser(updated) })
              return
            }
            throw httpError(405, "method-not-allowed", "仅支持 PATCH/DELETE")
          } catch (error) { handleError(res, error) }
        },
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  void bootstrapAdminAccount(users, config, ctx)
}

async function bootstrapAdminAccount(
  users: UsersService,
  config: AuthResolvedConfig,
  ctx: Context,
): Promise<void> {
  if (config.mode !== "multi-user") return
  const logger = (ctx as unknown as { logger?: { info?(msg: string): void; warn?(msg: string): void } }).logger
  try {
    if ((await users.listUsers()).length > 0) return
    const boot = config.bootstrapAdmin
    if (!boot) {
      logger?.warn?.("[octopus-auth] 用户表为空且未配置 bootstrapAdmin：请在 profile 配置中设置后重启")
      return
    }
    await users.createUser({
      username: boot.username,
      passwordHash: await hashPassword(boot.password),
      role: "admin",
    })
    logger?.info?.("[octopus-auth] 已创建初始管理员账户")
  } catch (error) {
    logger?.warn?.(`[octopus-auth] 初始化管理员失败: ${String(error)}`)
  }
}

export default { name, inject, Config, apply }
```

> 两处落地修正（实现时直接采用）：
> 1. `/login` handler 中的 `require("./login-page")` 是 CJS 残留，改为顶部 `import { renderLoginPage } from "./login-page.js"` 并直接调用；
> 2. PATCH 分支里 `assertNotLastAdmin` 的调用条件写得啰嗦，收敛为：`if (willDemote || willDisable) await assertNotLastAdmin(id, true)`（删除分支已单独调用）。注意语义：降级或禁用最后一个可用 admin 都要拒绝；改密码不受限。

- [ ] **Step 6: 运行确认失败 → 修复 → 通过**

Run: `pnpm --filter octopus-auth test`
Expected: 先 FAIL（index.ts 尚为骨架占位），实现后 PASS。常见修复点：Context.provide 断言需 mockContext 带 `provide: vi.fn()`（上面 setup 已含）。

- [ ] **Step 7: Commit**

```bash
git add packages/octopus-auth
git commit -m "feat(octopus-auth): wire plugin endpoints, login page, and bootstrap admin"
```

---

### Task 7: 管理端点行为保证测试（安全规则收口）

**Files:**
- Test: `packages/octopus-auth/src/admin-api.test.ts`

**Interfaces:**
- Consumes: Task 6 装配出的路由表与 `createFakeUsers`/`createRes`。
- Produces: 纯行为回归网（无新导出）——非 admin 写操作 403；未登录 401；弱密码 400；重复用户名 409；对自己 DELETE/禁用 400 self-operation；降级最后一个 admin 400 last-admin；正常增删改走通且重置密码后旧密码失效。

- [ ] **Step 1: 写测试 `src/admin-api.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest"
import { apply, resolveAuthConfig } from "./index.js"
import { createFakeUsers, createRes } from "./testing.js"
import { hashPassword } from "./hash.js"

const SAME_ORIGIN = { origin: "http://localhost", host: "localhost" }

function setup() {
  const register = vi.fn(() => vi.fn())
  const users = createFakeUsers()
  const ctx: any = {
    webServer: { register }, users,
    effect: vi.fn(), logger: { info: vi.fn(), warn: vi.fn() },
  }
  apply(ctx, resolveAuthConfig({}))
  const routes = new Map(register.mock.calls.map((c: any[]) => [`${c[0].kind} ${c[0].path}`, c[0]]))
  return { users, routes }
}

async function makeAdmin(users: ReturnType<typeof createFakeUsers>, username: string, role: "admin" | "user") {
  await users.createUser({ username, passwordHash: "", role })
  const u = (await users.findByUsername(username))!
  await users.updateUser(u.id, { passwordHash: await hashPassword("passw0rd!") })
  return (await users.findByUsername(username))!
}

async function login(routes: Map<string, any>, username: string, ip: string) {
  const res = createRes()
  await routes.get("exact /api/octopus-auth/login")!.handler(
    { method: "POST", url: "/x", headers: { ...SAME_ORIGIN }, socket: { remoteAddress: ip } } as any,
    res, JSON.stringify({ username, password: "passw0rd!" }),
  )
  expect(res.calls[0].status).toBe(200)
  return res.calls[0].headers["set-cookie"] as string
}

describe("用户管理 API 行为保证", () => {
  it("未登录 401；普通用户 403", async () => {
    const { users, routes } = setup()
    await makeAdmin(users, "plain", "user")
    const anon = createRes()
    await routes.get("exact /api/octopus-auth/users")!.handler(
      { method: "GET", headers: {} } as any, anon)
    expect(anon.calls[0].status).toBe(401)

    const userCookie = await login(routes, "plain", "ip-u")
    const forbidden = createRes()
    await routes.get("exact /api/octopus-auth/users")!.handler(
      {
        method: "POST", url: "/x",
        headers: { ...SAME_ORIGIN, cookie: userCookie }, socket: { remoteAddress: "ip-u" },
      } as any, forbidden, JSON.stringify({ username: "nx", password: "longenough1" }))
    expect(forbidden.calls[0].status).toBe(403)
  })

  it("创建：弱密码 400；重复用户名 409；成功 201", async () => {
    const { users, routes } = setup()
    await makeAdmin(users, "boss", "admin")
    const cookie = await login(routes, "boss", "ip-b")
    const call = (body: unknown) => {
      const res = createRes()
      return routes.get("exact /api/octopus-auth/users")!.handler(
        {
          method: "POST", url: "/x",
          headers: { ...SAME_ORIGIN, cookie }, socket: { remoteAddress: `ip-${Math.random()}` },
        } as any, res, JSON.stringify(body),
      ).then(() => res.calls[0])
    }
    expect((await call({ username: "a1", password: "short" })).status).toBe(400)
    expect((await call({ username: "BOSS", password: "longenough1" })).status).toBe(409)
    expect((await call({ username: "newbie", password: "longenough1", role: "user" })).status).toBe(201)
  })

  it("不能删除自己；不能禁用自己；不能降级最后一个 admin", async () => {
    const { users, routes } = setup()
    const boss = await makeAdmin(users, "boss", "admin")
    const cookie = await login(routes, "boss", "ip-b")
    const del = createRes()
    await routes.get("prefix /api/octopus-auth/users/")!.handler(
      {
        method: "DELETE", url: `/api/octopus-auth/users/${boss.id}`,
        headers: { ...SAME_ORIGIN, cookie }, socket: { remoteAddress: "ip-b" },
      } as any, del)
    expect(del.calls[0].status).toBe(400)
    expect(JSON.parse(del.calls[0].body).error).toBe("self-operation")

    const disableSelf = createRes()
    await routes.get("prefix /api/octopus-auth/users/")!.handler(
      {
        method: "PATCH", url: `/api/octopus-auth/users/${boss.id}`,
        headers: { ...SAME_ORIGIN, cookie }, socket: { remoteAddress: "ip-b" },
      } as any, disableSelf, JSON.stringify({ disabled: true }))
    expect(JSON.parse(disableSelf.calls[0].body).error).toBe("self-operation")

    const demote = createRes()
    await routes.get("prefix /api/octopus-auth/users/")!.handler(
      {
        method: "PATCH", url: `/api/octopus-auth/users/${boss.id}`,
        headers: { ...SAME_ORIGIN, cookie }, socket: { remoteAddress: "ip-b" },
      } as any, demote, JSON.stringify({ role: "user" }))
    expect(demote.calls[0].status).toBe(400)
    expect(JSON.parse(demote.calls[0].body).error).toBe("last-admin")
  })

  it("第二个 admin 存在时可降级前者；重置密码后旧密码失效；删除用户注销其会话", async () => {
    const { users, routes } = setup()
    const boss = await makeAdmin(users, "boss", "admin")
    await makeAdmin(users, "vice", "admin")
    const tempRes = createRes()
    await routes.get("exact /api/octopus-auth/users")!.handler(
      {
        method: "POST", url: "/x", headers: { ...SAME_ORIGIN, cookie: await login(routes, "boss", "ip-b") },
        socket: { remoteAddress: "ip-r" },
      } as any, tempRes, JSON.stringify({ username: "temp", password: "temp-pass1", role: "user" }))
    const tempId = JSON.parse(tempRes.calls[0].body).user.id

    const reset = createRes()
    await routes.get("prefix /api/octopus-auth/users/")!.handler(
      {
        method: "PATCH", url: `/api/octopus-auth/users/${tempId}`,
        headers: { ...SAME_ORIGIN, cookie: await login(routes, "vice", "ip-v") },
        socket: { remoteAddress: "ip-v" },
      } as any, reset, JSON.stringify({ password: "brand-new99" }))
    expect(reset.calls[0].status).toBe(200)

    const demoteVice = createRes()
    const vice = (await users.findByUsername("vice"))!
    await routes.get("prefix /api/octopus-auth/users/")!.handler(
      {
        method: "PATCH", url: `/api/octopus-auth/users/${vice.id}`,
        headers: { ...SAME_ORIGIN, cookie: await login(routes, "boss", "ip-b") },
        socket: { remoteAddress: "ip-b" },
      } as any, demoteVice, JSON.stringify({ role: "user" }))
    expect(demoteVice.calls[0].status).toBe(200)

    const removed = createRes()
    await routes.get("prefix /api/octopus-auth/users/")!.handler(
      {
        method: "DELETE", url: `/api/octopus-auth/users/${tempId}`,
        headers: { ...SAME_ORIGIN, cookie: await login(routes, "boss", "ip-b2") },
        socket: { remoteAddress: "ip-b2" },
      } as any, removed)
    expect(removed.calls[0].status).toBe(200)
    await expect(users.getUser(tempId)).resolves.toBeNull()
  })

  it("CSRF：缺 Origin 的 POST 创建被拒 403", async () => {
    const { users, routes } = setup()
    await makeAdmin(users, "boss", "admin")
    const cookie = await login(routes, "boss", "ip-b")
    const res = createRes()
    await routes.get("exact /api/octopus-auth/users")!.handler(
      { method: "POST", url: "/x", headers: { cookie }, socket: { remoteAddress: "ip-b" } } as any,
      res, JSON.stringify({ username: "x9", password: "longenough1" }))
    expect(res.calls[0].status).toBe(403)
  })

  void vi
})
```

- [ ] **Step 2: 运行并修复缺口**

Run: `pnpm --filter octopus-auth test`
Expected: 若 Task 6 实现有遗漏（如 PATCH 分支的 last-admin 条件、UsersError→409 映射缺失），此处暴露；按 Task 6 的「落地修正」清单修齐直至 PASS。

- [ ] **Step 3: Commit**

```bash
git add packages/octopus-auth
git commit -m "test(octopus-auth): cover admin api guards, validation mapping, and csrf rules"
```

---

### Task 8: octopus-users-view 包骨架 —— 卡片注册 + 静态托管

**Files:**
- Create: `packages/octopus-users-view/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `cordis.patch.yml`, `src/index.ts`
- Test: `packages/octopus-users-view/src/index.test.ts`

**Interfaces:**
- Consumes: `octopus` 导出的 `serveStaticFiles`（运行时，先例：quickstart）。
- Produces: 插件注册卡片 `{ id: 'users-view', title: '用户管理', access: 'admin', order: 900, entry: '/octopus/users-view/assets/index.js' }` 与资源前缀路由 `/octopus/users-view/assets`（immutable 缓存）。

- [ ] **Step 1: 骨架文件**

`package.json`：
```json
{
  "name": "octopus-users-view",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "import": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "web/dist", "cordis.patch.yml", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && vite build web --config web/vite.config.ts && tsc -p web/tsconfig.json",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "octopus": "^0.1.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "octopus": "file:../octopus",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^4.1.8"
  },
  "dsh.bundle.patch": "./cordis.patch.yml"
}
```

配置文件从 quickstart 复制；`cordis.patch.yml` 用 `id/name: octopus-users-view`。

- [ ] **Step 2: 失败测试 `src/index.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest"
import { apply } from "./index.js"

describe("octopus-users-view", () => {
  it("注册 admin 可见的用户管理卡片并托管资源路由", () => {
    const workbench = { register: vi.fn(() => vi.fn()) }
    const webServer = { register: vi.fn(() => vi.fn()) }
    const ctx: any = { workbench, webServer, effect: vi.fn((f: () => () => void) => f()) }
    apply(ctx)
    expect(workbench.register).toHaveBeenCalledWith({
      id: "users-view",
      title: "用户管理",
      access: "admin",
      order: 900,
      entry: "/octopus/users-view/assets/index.js",
    })
    expect(webServer.register).toHaveBeenCalledWith(expect.objectContaining({
      kind: "prefix",
      path: "/octopus/users-view/assets",
    }))
  })
})
```

Run: `pnpm install && pnpm --filter octopus-users-view test` Expected: FAIL（index.ts 不存在）

- [ ] **Step 3: 实现 `src/index.ts`**

```ts
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "@deepseek-ai/cordis"
import { serveStaticFiles } from "octopus"

export const name = "octopus-users-view"
export const inject = ["workbench", "webServer"] as const

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(HERE, "..", "web", "dist")

export function apply(ctx: Context) {
  ctx.effect(() => {
    const disposers = [
      ctx.workbench.register({
        id: "users-view",
        title: "用户管理",
        access: "admin",
        order: 900,
        entry: "/octopus/users-view/assets/index.js",
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/octopus/users-view/assets",
        handler: serveStaticFiles(DIST_DIR, "/octopus/users-view/assets", {
          cacheControl: "public, max-age=31536000, immutable",
        }),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

export default { name, inject, apply }
```

> 此步骤会因 `access` 尚不存在于 `WorkbenchModule` 而 TS 报错——属预期（vitest 运行不做跨包类型检查，用例可通过）；Task 10 给壳加字段后消除。

- [ ] **Step 4: 测试通过 → Commit**

```bash
git add packages/octopus-users-view pnpm-lock.yaml
git commit -m "feat(octopus-users-view): add plugin skeleton registering admin card and assets route"
```

---

### Task 9: octopus-users-view 管理 UI（API 封装 + React 组件）

**Files:**
- Create: `packages/octopus-users-view/web/vite.config.ts`, `web/tsconfig.json`, `web/src/api.ts`, `web/src/index.tsx`
- Test: `packages/octopus-users-view/web/src/api.test.ts`

**Interfaces:**
- Consumes: auth 的 HTTP API 契约（Task 6/7 定型）。
- Produces: `web/dist/index.js`（Vite library ES module，default export React 组件，react 系走壳 vendor 外链）；`web/src/api.ts` 导出：
  ```ts
  export interface ManagedUser { id: string; username: string; role: 'admin' | 'user'; disabled: boolean; createdAt: number }
  export class ApiError extends Error { readonly status: number; readonly code: string }
  export async function listUsers(): Promise<ManagedUser[]>
  export async function createUser(input: { username: string; password: string; role: 'admin' | 'user' }): Promise<void>
  export async function patchUser(id: string, patch: { role?: 'admin' | 'user'; disabled?: boolean; password?: string }): Promise<void>
  export async function deleteUser(id: string): Promise<void>   // DELETE 前由 UI 层 confirm()
  ```

- [ ] **Step 1: 构建配置**

`web/vite.config.ts`（照抄 quickstart 模式）：
```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { octopusVendor } from "octopus/vite"

export default defineConfig({
  plugins: [react(), octopusVendor()],
  build: {
    outDir: "../web/dist",
    emptyOutDir: true,
    lib: { entry: "src/index.tsx", formats: ["es"] },
    rollupOptions: { output: { entryFileNames: "index.js" } },
  },
})
```

`web/tsconfig.json`：复制 quickstart 的 `web/tsconfig.json`。

- [ ] **Step 2: 失败测试 `web/src/api.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, createUser, deleteUser, listUsers, patchUser } from "./api.js"

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  )
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe("api 封装", () => {
  it("listUsers 解析 users 数组", async () => {
    mockFetchOnce(200, { users: [{ id: "1", username: "a", role: "user", disabled: false, createdAt: 1 }] })
    await expect(listUsers()).resolves.toHaveLength(1)
  })

  it("错误响应抛 ApiError 并携带状态码与 code", async () => {
    mockFetchOnce(409, { error: "conflict", message: "用户名已存在" })
    await expect(createUser({ username: "a", password: "longenough1", role: "user" }))
      .rejects.toBeInstanceOf(ApiError)
    const err = await createUser({ username: "a", password: "longenough1", role: "user" }).catch((e) => e)
    expect(err.status).toBe(409)
    expect(err.code).toBe("conflict")
  })

  it("patchUser/deleteUser 发送正确方法与路径", async () => {
    const fn = mockFetchOnce(200, { ok: true })
    await patchUser("uid", { disabled: true })
    expect(fn.mock.calls[0][0]).toBe("/api/octopus-auth/users/uid")
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe("PATCH")
    await deleteUser("uid")
    expect((fn.mock.calls[1][1] as RequestInit).method).toBe("DELETE")
  })
})
```

- [ ] **Step 3: 实现 `web/src/api.ts`**

```ts
export interface ManagedUser {
  id: string
  username: string
  role: "admin" | "user"
  disabled: boolean
  createdAt: number
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  })
  if (!res.ok) {
    let code = String(res.status)
    let message = res.statusText
    try {
      const data = (await res.json()) as { error?: string; message?: string }
      code = data.error ?? code
      message = data.message ?? message
    } catch {
      // 保持默认
    }
    throw new ApiError(res.status, code, message)
  }
  return res.status === 204 ? null : res.json()
}

export async function listUsers(): Promise<ManagedUser[]> {
  const data = (await request("/api/octopus-auth/users")) as { users: ManagedUser[] }
  return data.users
}

export async function createUser(
  input: { username: string; password: string; role: "admin" | "user" },
): Promise<void> {
  await request("/api/octopus-auth/users", { method: "POST", body: JSON.stringify(input) })
}

export async function patchUser(
  id: string,
  patch: { role?: "admin" | "user"; disabled?: boolean; password?: string },
): Promise<void> {
  await request(`/api/octopus-auth/users/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify(patch),
  })
}

export async function deleteUser(id: string): Promise<void> {
  await request(`/api/octopus-auth/users/${encodeURIComponent(id)}`, { method: "DELETE" })
}
```

- [ ] **Step 4: 实现 `web/src/index.tsx`**（内联样式，中文文案，无额外依赖）

```tsx
import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { ApiError, createUser, deleteUser, listUsers, patchUser, type ManagedUser } from "./api.js"

const s: Record<string, CSSProperties> = {
  wrap: { fontFamily: "system-ui, sans-serif", fontSize: 14, maxWidth: 720 },
  form: { display: "flex", gap: 8, margin: "12px 0", alignItems: "center", flexWrap: "wrap" },
  input: { padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6 },
  select: { padding: "6px", border: "1px solid #d1d5db", borderRadius: 6 },
  btn: { padding: "5px 12px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #e5e7eb" },
  name: { flex: 1 },
  badge: { fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "#e5e7eb" },
  danger: { color: "#b91c1c" },
  err: { color: "#dc2626", marginTop: 8 },
}

export default function UsersView() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [error, setError] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")

  const refresh = useCallback(async () => {
    try {
      setUsers(await listUsers())
      setError("")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const onCreate = async () => {
    try {
      await createUser({ username, password, role })
      setUsername(""); setPassword("")
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  const onPatch = async (id: string, patch: Parameters<typeof patchUser>[1]) => {
    try {
      await patchUser(id, patch)
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  const onDelete = async (u: ManagedUser) => {
    if (!window.confirm(`确定删除 ${u.username}？其所有会话将被注销。`)) return
    try {
      await deleteUser(u.id)
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  const onResetPassword = async (u: ManagedUser) => {
    const pwd = window.prompt(`为 ${u.username} 设置新密码（至少 8 位）`)
    if (pwd === null) return
    if (pwd.length < 8) { setError("密码至少 8 位"); return }
    await onPatch(u.id, { password: pwd })
  }

  return (
    <div style={s.wrap}>
      <div style={s.form}>
        <input style={{ ...s.input, width: 140 }} placeholder="用户名" value={username}
          onChange={(e) => setUsername(e.target.value)} />
        <input style={{ ...s.input, width: 140 }} placeholder="密码（≥8位）" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        <select style={s.select} value={role} onChange={(e) => setRole(e.target.value as "admin" | "user")}>
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <button style={s.btn} onClick={() => void onCreate()} disabled={!username || password.length < 8}>
          创建用户
        </button>
      </div>
      {error && <div style={s.err}>{error}</div>}
      {users.map((u) => (
        <div key={u.id} style={s.row}>
          <span style={{ ...s.name, ...(u.disabled ? s.danger : {}) }}>
            {u.username}{u.disabled ? "（已禁用）" : ""}
          </span>
          <span style={s.badge}>{u.role === "admin" ? "管理员" : "用户"}</span>
          <button style={s.btn} onClick={() => void onResetPassword(u)}>重置密码</button>
          <button style={s.btn} onClick={() => void onPatch(u.id, { disabled: !u.disabled })}>
            {u.disabled ? "启用" : "禁用"}
          </button>
          <button style={{ ...s.btn, ...(u.disabled ? {} : s.danger) }} onClick={() => void onDelete(u)}>
            删除
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: 测试通过 → 构建 → Commit**

Run: `pnpm --filter octopus-users-view test && pnpm --filter octopus-users-view build`
Expected: 测试 PASS；构建产出 `web/dist/index.js`（内容含 `/workbench/assets/vendor/jsx-runtime.js` 外链）

```bash
git add packages/octopus-users-view
git commit -m "feat(octopus-users-view): add admin users management ui with vendor externals"
```

---

### Task 10: octopus 壳改造 —— inject auth、模块过滤、类型扩展

**Files:**
- Modify: `packages/octopus/package.json`、`src/static.ts`、`src/workbench.ts`、`src/index.ts`、`src/index.test.ts`

**Interfaces:**
- Consumes: `octopus-auth` 的 `AuthService`（type-only）。
- Produces:
  ```ts
  // static.ts 扩展（结构兼容 node:http 与 RequestLike）
  interface HttpRequest {
    method?: string
    url?: string
    headers: Record<string, string | string[] | undefined>   // 改为必有字段
    socket?: { remoteAddress?: string }
  }
  // workbench.ts
  interface WorkbenchModule { id: string; title: string; order?: number; entry: string; access?: 'authenticated' | 'admin' }  // 新增可选 access
  // index.ts
  export const inject: ["webServer", "auth"]
  declare module "@deepseek-ai/cordis" { interface Context { workbench: WorkbenchRegistry; webServer: WebServerLike; auth: AuthService } }
  // 行为：/api/octopus/config 与 /api/octopus/modules 先 requireAuth（HttpError→对应 JSON 状态码）；
  // modules 按 session.user.role 过滤 access==='admin'
  ```
  注意：运行时 import 只允许来自 octopus-auth 的**值**导入 `isHttpError`（方向合法：octopus→auth）；`AuthService` 仅 `import type`。

- [ ] **Step 1: 更新失败测试（改写 `src/index.test.ts` 相关用例）**

在现有 `mockContext()` 中追加 auth stub，并把 config/modules 用例改为鉴权语境。关键改动：

```ts
// mockContext() 内新增：
const auth = {
  requireAuth: vi.fn(async () => ({ sessionId: "test", user: { id: "u1", username: "tester", role: "admin" }, expiresAt: Number.POSITIVE_INFINITY })),
  requireAdmin: vi.fn(),
}
const ctx: any = { provide: vi.fn(), webServer, auth, effect: vi.fn(/* 同现有 */) }

// 新增用例 1：未登录返回 401
it("modules/config 在未登录时返回 401 JSON", async () => {
  const { ctx, webServer } = mockContext()
  ctx.auth.requireAuth.mockRejectedValueOnce(new HttpError(401, "unauthorized", "未登录"))
  apply(ctx, {})
  const routes = registeredRoutes(webServer)
  const res = createRes()
  await routes.get("exact /api/octopus/modules")!.handler({ method: "GET", url: "/x", headers: {} }, res)
  expect(res.calls[0].status).toBe(401)
  expect(JSON.parse(res.calls[0].body).error).toBe("unauthorized")
})

// 新增用例 2：普通用户看不到 admin 卡片
it("modules 按 role 过滤 admin 卡片", async () => {
  const { ctx, webServer } = mockContext()
  ctx.auth.requireAuth.mockResolvedValue({ sessionId: "t", user: { id: "u", username: "u", role: "user" }, expiresAt: 1 })
  apply(ctx, {})
  const registry = ctx.provide.mock.calls[0][1]
  registry.register({ id: "a", title: "A", entry: "/a.js" })
  registry.register({ id: "b", title: "B", entry: "/b.js", access: "admin" })
  const routes = registeredRoutes(webServer)
  const res = createRes()
  await routes.get("exact /api/octopus/modules")!.handler({ method: "GET", url: "/x", headers: {} }, res)
  expect(JSON.parse(res.calls[0].body).map((m: any) => m.id)).toEqual(["a"])
})

// 现有「serves config and modules JSON」用例：请求对象补 headers: {}；其余断言不变（stub 默认 admin 全放行）
// 现有「registers the expected routes」用例：期望键集合不变（路径未增减），无需修改
```

顶部 import 增加 `import { HttpError } from "octopus-auth"`（devDep 已加）。同时给既有全部 handler 直调用例的 req 对象统一补 `headers: {}`（新 HttpRequest 类型要求该字段存在）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus test` Expected: FAIL（auth 注入缺失 / 过滤逻辑不存在）

- [ ] **Step 3: 实现改造**

`package.json`（octopus）：peerDependencies 增加 `"octopus-auth": "^0.1.0"`；devDependencies 增加 `"octopus-auth": "file:../octopus-auth"`。

`src/static.ts`：`HttpRequest` 接口改为：
```ts
export interface HttpRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}
```
（serveStaticFiles 不读 headers，行为不变；`static.test.ts` 各用例的 req 对象补 `headers: {}`。）

`src/workbench.ts`：`WorkbenchModule` 增加：
```ts
/** 缺省视为 'authenticated'；'admin' 仅管理员可见 */
access?: "authenticated" | "admin"
```

`src/index.ts` 关键改动：
```ts
import { isHttpError, type AuthService } from "octopus-auth"
// ...
export const inject = ["webServer", "auth"]

declare module "@deepseek-ai/cordis" {
  interface Context {
    workbench: WorkbenchRegistry
    webServer: WebServerLike
    auth: AuthService
  }
}

type AuthedHandler = (req: HttpRequest, res: HttpResponse) => Promise<void>

/** 统一鉴权包装：requireAuth 抛 HttpError 时转 JSON 状态码并短路 */
function withAuth(auth: AuthService, inner: (session: Awaited<ReturnType<AuthService["requireAuth"]>>, req: HttpRequest, res: HttpResponse) => Promise<void>): AuthedHandler {
  return async (req, res) => {
    let session
    try {
      session = await auth.requireAuth(req)
    } catch (error) {
      if (isHttpError(error)) {
        res.writeHead(error.statusCode, { "content-type": "application/json; charset=utf-8" })
        res.end(JSON.stringify({ error: error.code, message: error.message }))
        return
      }
      throw error
    }
    await inner(session, req, res)
  }
}
```

`apply()` 中两个 API 路由替换为：
```ts
ctx.webServer.register({
  kind: "exact", path: "/api/octopus/config",
  handler: withAuth(auth, async (_session, _req, res) => {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    res.end(JSON.stringify(effective))
  }),
}),
ctx.webServer.register({
  kind: "exact", path: "/api/octopus/modules",
  handler: withAuth(auth, async (session, _req, res) => {
    const visible = registry.list().filter(
      (m) => m.access !== "admin" || session.user.role === "admin",
    )
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    res.end(JSON.stringify(visible))
  }),
}),
```
（`jsonHandler` 若不再被引用则删除；原 `jsonHandler(() => ...)` 两处由上式取代。）

- [ ] **Step 4: 运行通过 → Commit**

Run: `pnpm --filter octopus test && pnpm --filter octopus run typecheck:web` Expected: PASS

```bash
git add packages/octopus pnpm-lock.yaml
git commit -m "feat(octopus): require auth on data apis and filter admin modules by role"
```

---

### Task 11: 壳前端 —— 登录引导与顶栏用户区

**Files:**
- Create: `packages/octopus/web/src/lib/auth.ts`
- Modify: `packages/octopus/web/src/App.tsx`（接线）、`packages/octopus/web/src/components/Header.tsx`（若存在顶栏组件则改之；否则在 App.tsx 顶部区域实现）
- Test: `packages/octopus/web/src/lib/auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // web/src/lib/auth.ts
  export interface MeResponse { user: { id: string; username: string; role: "admin" | "user" }; canLogout: boolean }
  export async function fetchMe(): Promise<MeResponse>       // GET /api/octopus-auth/me；非 2xx 抛 Error('unauthorized')
  export function redirectToLogin(reason?: string): void     // location.href='/login?redirect=' + encodeURIComponent(当前路径)
  export async function logout(): Promise<void>              // POST logout 后 redirectToLogin()
  ```
  App 行为契约：挂载时 fetchMe()——成功则正常渲染并把 `me` 传入 Header（显示用户名；canLogout 时渲染「退出」按钮调 logout()）；抛错则 redirectToLogin() 且不渲染受保护内容。ModuleGrid 无需改动。

**执行前置动作**：先读当前 `packages/octopus/web/src/App.tsx` 与 components 目录，确认现有结构与测试风格再动刀；以下代码为新增模块与接线片段。

- [ ] **Step 1: 失败测试 `web/src/lib/auth.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchMe, redirectToLogin } from "./auth.js"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("fetchMe", () => {
  it("返回 me 载荷", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ user: { id: "1", username: "boss", role: "admin" }, canLogout: true }),
      { status: 200 },
    )))
    await expect(fetchMe()).resolves.toMatchObject({ canLogout: true })
  })

  it("401 时抛 unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })))
    await expect(fetchMe()).rejects.toThrow(/unauthorized/)
  })
})

describe("redirectToLogin", () => {
  it("携带同源 redirect 参数跳转登录页", () => {
    const assign = vi.fn()
    Object.defineProperty(window, "location", { value: { href: "", assign }, writable: true })
    redirectToLogin()
    expect(window.location.href).toBe(
      `/login?redirect=${encodeURIComponent(window.location.pathname)}`,
    )
  })
})
```

- [ ] **Step 2: 实现 `web/src/lib/auth.ts`**

```ts
export interface MeResponse {
  user: { id: string; username: string; role: "admin" | "user" }
  canLogout: boolean
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch("/api/octopus-auth/me", { credentials: "same-origin" })
  if (!res.ok) throw new Error("unauthorized")
  return (await res.json()) as MeResponse
}

export function redirectToLogin(_reason?: string): void {
  window.location.href =
    `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
}

export async function logout(): Promise<void> {
  await fetch("/api/octopus-auth/logout", { method: "POST", credentials: "same-origin" })
  redirectToLogin()
}
```

- [ ] **Step 3: 接线 App.tsx / Header**

在 App 组件顶部加入（保持项目现有的 hooks 风格；若已有全局数据加载 effect 则合并进去）：

```tsx
const [me, setMe] = useState<MeResponse | null>(null)
useEffect(() => {
  fetchMe()
    .then(setMe)
    .catch(() => redirectToLogin())
}, [])
if (me === null) return null   // 未完成身份检查前不渲染任何受保护内容
```

顶栏右侧（Header 组件或 App 顶栏 JSX）：

```tsx
{me !== null && (
  <div className="header-user">
    <span>{me.user.username}</span>
    {me.canLogout && (
      <button onClick={() => void logout()} className="header-logout">退出</button>
    )}
  </div>
)}
```

若壳的 web 测试对 App 有渲染断言（testing-library），为受影响用例 stub `fetchMe`（vi.mock 该模块）或 stub global fetch 返回 me 载荷；保证既有用例语义不变。

- [ ] **Step 4: 运行 web 测试与类型检查 → Commit**

Run: `pnpm --filter octopus test && pnpm --filter octopus run build`
Expected: 全绿且构建通过

```bash
git add packages/octopus/web
git commit -m "feat(octopus): bootstrap auth check and header user area in shell frontend"
```

---

### Task 12: 根脚本、README 部署章节、手动联调清单

**Files:**
- Modify: 根 `package.json`、新建 `README.md` 的「权限体系」章节（若根 README 已有结构则追加；否则创建精简版）
- Modify: `docs/superpowers/specs/2026-08-25-octopus-auth-design.md` 不改动（spec 冻结）

- [ ] **Step 1: 更新根 dev scripts**

两个脚本的 add 列表按依赖顺序追加三个包：

```json
"dev": "pnpm install && pnpm build && pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-users ./packages/octopus-auth ./packages/octopus-users-view ./packages/octopus-quickstart --config.auto-install-peers=false && pnpm dsh web",
"dev:noopen": "（同上，结尾 --no-open）"
```

- [ ] **Step 2: README 权限章节（内容要点逐条写入）**

1. 本机开发：profile 配置中将 `octopus-auth.mode` 设为 `single-user`（免登录直通）；storage-json 后端需配置 `root` 目录；
2. 公网部署四强制项：dsh 绑定 127.0.0.1；反代 TLS + forward_auth 全局套用且豁免 `/login`、`/api/octopus-auth/login`、`/api/octopus-auth/verify` 三路径（防 subrequest 自递归）；`octopus-auth.secureCookie=true`；反代绑定确切站点名、默认 server 拒绝；
3. Caddy 配置示例直接抄 spec §9.2 代码块；
4. single-user 模式暴露公网 = 人人是管理员，红字警告；
5. 首次初始化：multi-user 下空用户表时在 profile 配置 `bootstrapAdmin` 后重启，或访问 /login 按提示操作。

- [ ] **Step 3: 手动联调清单执行并记录结果**

按序验证并在 PR 描述勾选：

```text
[ ] pnpm dev 启动后 /workbench 正常（single-user 免登录）
[ ] 切 multi-user：访问 /workbench 被 /me 引导跳到 /login
[ ] 错误密码显示"用户名或密码错误"；连续 5 次后显示限速提示（429）
[ ] 登录成功回到工作台；刷新不掉线（会话持久化）
[ ] 管理员可见「用户管理」卡片；普通用户不可见
[ ] 管理界面：建号→新用户登录→禁用→其会话立即失效（刷新即踢回登录页）
[ ] 不能禁用/删除自己；最后一个 admin 不可降级/删除
[ ] 登出按钮清会话回登录页
[ ] verify：curl 无 cookie 得 401；带有效 cookie 得 204
```

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "docs: document auth deployment posture and wire new plugins into dev scripts"
```

---

### Task 13: 全量收尾

- [ ] **Step 1:** Run: `pnpm install && pnpm -r build && pnpm -r test` — Expected: 全部包构建与测试通过
- [ ] **Step 2:** 按 Task 12 清单跑一遍本地 profile 联调（storage-json root 指向临时目录；single-user 与 multi-user 各一轮）
- [ ] **Step 3:** `git status` 确认无遗漏产物入库（lib/、web-dist/、web/dist 均在 .gitignore）
- [ ] **Step 4:** 如一切就绪，合并回 dev 由维护者执行（本计划不含 push/merge 动作）

## Self-Review 记录

- Spec 覆盖核对：§3 三插件=T1/T2/T3/T6/T8/T9；§4 契约=T2(service)+T5(auth)+T10(access 字段)；§5 会话安全=T3/T4/T5/T7；§6 端点表=T6/T7+T10(verify 属 auth)；§7 壳与前端=T10/T11；§8 安全表=XFF(T5 bucketKeyOf)、redirect 校验(T6 login-page)、cookie tossing(T5 无 Domain/__Host-)、恒定工作量(T5 dummy)、rebinding(部署文档 T12)、single-user 警告(T6 warn 日志+T12 红字)、Origin 严格(T5)、会话固定(T5 每次登录新 ID)；§9 部署=T12；§10 测试=各任务内嵌；§11 边界=T12 README 要点。无缺口。
- 占位符扫描：无 TBD/TODO；“落地修正”两处均为明确指令而非含糊表述。
- 类型一致性抽查：`UsersService` 签名在 T2 定义、T5 testing.ts 与 T6 使用处一致；`RequestLike.headers` 为可选对象而 T10 将壳的 `HttpRequest.headers` 定为必有——IncomingMessage 结构兼容，直传成立；`access` 字段 T10 定义先于 T8 的使用警告已在 T8 注明预期报错。
