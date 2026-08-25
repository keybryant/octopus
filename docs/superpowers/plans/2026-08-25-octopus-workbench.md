# octopus 工作台插件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 pnpm workspace 单仓：`octopus` 工作台壳插件 + `octopus-quickstart` 示例功能插件，通过 `pnpm dev` 一行命令在 dsh web 中启动 `/workbench` 欢迎页。

**Architecture:** 壳插件通过 `ctx.provide("workbench", registry)` 提供服务契约，功能插件 `inject: ["workbench"]` 注册模块并自托管客户端 bundle；壳页面 `/api/octopus/modules` 读取模块列表，`import(entry)` 懒加载挂载。客户端 bundle 通过 resolveId 插件把 `react` 系列裸导入改写为壳托管的 vendor URL（浏览器 ESM 不支持裸导入）。

**Tech Stack:** TypeScript (host, tsc→lib/)、React 18 + Vite 6 (web)、@deepseek-ai/cordis ^4.0.1、@deepseek-ai/schemastery ^3.18.1、vitest ^4.1.8、@deepseek-ai/dsh ^0.1.1-rc.2 (root devDependency)。

**Spec:** `docs/superpowers/specs/2026-08-25-octopus-workbench-design.md`

## Global Constraints

- Node >= 22.19（本机 24.13.0）；pnpm >= 10（本机 10.32.1）；Windows（win32）——npm script 用 `&&`（cmd 支持），手工命令用 PowerShell
- 全部包为 ESM（`"type": "module"`），NodeNext 下相对导入必须带 `.js` 后缀
- 包名/插件 id：`octopus`、`octopus-quickstart`；模块 id：`quickstart`，title `快捷入口`，order 10，entry `/octopus/quickstart/assets/index.js`
- 壳路由：`exact /workbench`、`prefix /workbench/assets`、`exact /api/octopus/config`、`exact /api/octopus/modules`（不占用 webserver fallback 席位）
- 前端 base：`/workbench/`；壳产物目录 `web-dist/`；功能插件 bundle 产物 `web/dist/`；vendor 产物 `web-dist/vendor/`
- vendor 契约 URL：`/workbench/assets/vendor/react.js`、`/workbench/assets/vendor/react-dom.js`、`/workbench/assets/vendor/jsx-runtime.js`
- 模块 bundle：ES format、default export React 组件、`react`/`react-dom`/`react/jsx-runtime` 外部化为上述 vendor URL
- 版本：react ^18.2.0、@types/react ~18.3.1、vite ^6.0.0、@vitejs/plugin-react ^4.0.0、vitest ^4.1.8、jsdom ^26、@testing-library/react ^16 + @testing-library/dom ^10、@testing-library/jest-dom ^6、typescript ^5.6、@types/node ^22
- UI 文案中文；代码不写注释（`/* @vite-ignore */` 为 vite 构建指令除外）
- 测试必须真实失败过再实现（TDD）；每个任务结束提交一次 git（Task 1 执行 `git init`，若用户否决 git 则跳过所有提交步骤）

---

### Task 1: Monorepo 脚手架

**Files:**
- Create: `package.json`（根）、`pnpm-workspace.yaml`、`.gitignore`
- Create: `packages/octopus/package.json`、`packages/octopus/tsconfig.json`、`packages/octopus/tsconfig.build.json`、`packages/octopus/vitest.config.ts`、`packages/octopus/cordis.patch.yml`
- Create: `packages/octopus-quickstart/package.json`、`packages/octopus-quickstart/tsconfig.json`、`packages/octopus-quickstart/tsconfig.build.json`、`packages/octopus-quickstart/vitest.config.ts`、`packages/octopus-quickstart/cordis.patch.yml`

**Interfaces:**
- Produces: pnpm workspace 可安装；`pnpm dsh --version` 可用；两包构建/测试脚本占位可用

- [ ] **Step 1: 写根配置文件**

`package.json`（根）：
```jsonc
{
  "name": "octopus-monorepo",
  "private": true,
  "packageManager": "pnpm@10.32.1",
  "scripts": {
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "dev": "pnpm install && pnpm build && pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-quickstart --config.auto-install-peers=false && pnpm dsh web",
    "dev:noopen": "pnpm install && pnpm build && pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-quickstart --config.auto-install-peers=false && pnpm dsh web --no-open"
  },
  "devDependencies": {
    "@deepseek-ai/dsh": "^0.1.1-rc.2"
  }
}
```

`pnpm-workspace.yaml`：
```yaml
packages:
  - packages/*
```

`.gitignore`：
```
node_modules/
lib/
web-dist/
web/dist/
*.tsbuildinfo
*.log
.superpowers/
```

- [ ] **Step 2: 写两个包的清单文件**

`packages/octopus/package.json`：
```jsonc
{
  "name": "octopus",
  "version": "0.1.0",
  "description": "octopus workbench shell plugin for DeepSeek Harness",
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
  "files": ["lib", "web-dist", "cordis.patch.yml", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && vite build --config web/vite.config.ts && vite build --config web/vendor.config.ts",
    "test": "vitest run && vitest run --config web/vitest.config.ts"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.0.0",
    "@types/react": "~18.3.1",
    "@types/react-dom": "~18.3.0",
    "@vitejs/plugin-react": "^4.0.0",
    "jsdom": "^26.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^4.1.8"
  }
}
```

`packages/octopus/cordis.patch.yml`：
```yaml
- insert:
    - id: octopus
      name: octopus
```

`packages/octopus/tsconfig.json`：
```jsonc
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

`packages/octopus/tsconfig.build.json`：
```jsonc
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

`packages/octopus/vitest.config.ts`：
```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
})
```

`packages/octopus-quickstart/package.json`：
```jsonc
{
  "name": "octopus-quickstart",
  "version": "0.1.0",
  "description": "Quickstart module plugin for the octopus workbench",
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
  "files": ["lib", "web/dist", "cordis.patch.yml", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && vite build --config web/vite.config.ts",
    "test": "vitest run"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "octopus": "^0.1.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@types/node": "^22.0.0",
    "@types/react": "~18.3.1",
    "@types/react-dom": "~18.3.0",
    "@vitejs/plugin-react": "^4.0.0",
    "octopus": "file:../octopus",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^4.1.8"
  }
}
```

`packages/octopus-quickstart/cordis.patch.yml`：
```yaml
- insert:
    - id: octopus-quickstart
      name: octopus-quickstart
```

`packages/octopus-quickstart/tsconfig.json` 与 `tsconfig.build.json`：内容同 octopus 包对应文件；`vitest.config.ts` 同 octopus 的。

- [ ] **Step 3: 安装依赖并验证**

Run: `pnpm install`（仓库根）
Expected: 安装成功，无报错；node_modules/.bin 出现 `dsh`。

- [ ] **Step 4: 验证 dsh CLI 可用**

Run: `pnpm dsh --version`
Expected: 打印版本号（如 0.1.1-rc.x）。

- [ ] **Step 5: git 初始化并提交**

```bash
git init
git add -A
git commit -m "chore: scaffold pnpm monorepo with dsh dependency"
```

---

### Task 2: octopus 注册表（workbench.ts）

**Files:**
- Create: `packages/octopus/src/workbench.ts`
- Test: `packages/octopus/src/workbench.test.ts`

**Interfaces:**
- Produces:
  - `interface WorkbenchModule { id: string; title: string; order?: number; entry: string }`
  - `interface WorkbenchRegistry { register(module: WorkbenchModule): () => void; list(): WorkbenchModule[] }`
  - `function createRegistry(): WorkbenchRegistry` — 重复 id 抛 `Error(/duplicate workbench module id/)`；`list()` 按 `order`（缺省 0）稳定排序（Array.sort 稳定，同 order 保持插入序）；register 返回 disposer（调用后移除该模块）

- [ ] **Step 1: 写失败测试**

`packages/octopus/src/workbench.test.ts`：
```ts
import { describe, expect, it } from "vitest"
import { createRegistry } from "./workbench.js"

describe("createRegistry", () => {
  it("registers and lists a module", () => {
    const registry = createRegistry()
    const module = { id: "a", title: "A", entry: "/a.js" }
    registry.register(module)
    expect(registry.list()).toEqual([module])
  })

  it("sorts by order and keeps insertion order for ties", () => {
    const registry = createRegistry()
    registry.register({ id: "a", title: "A", order: 1, entry: "/a.js" })
    registry.register({ id: "b", title: "B", order: 0, entry: "/b.js" })
    registry.register({ id: "c", title: "C", order: 1, entry: "/c.js" })
    expect(registry.list().map((m) => m.id)).toEqual(["b", "a", "c"])
  })

  it("defaults missing order to 0", () => {
    const registry = createRegistry()
    const module = { id: "a", title: "A", entry: "/a.js" }
    registry.register(module)
    expect(registry.list()).toEqual([module])
  })

  it("rejects duplicate ids", () => {
    const registry = createRegistry()
    registry.register({ id: "a", title: "A", entry: "/a.js" })
    expect(() =>
      registry.register({ id: "a", title: "A2", entry: "/a2.js" }),
    ).toThrow(/duplicate/)
  })

  it("disposer removes the module", () => {
    const registry = createRegistry()
    const dispose = registry.register({ id: "a", title: "A", entry: "/a.js" })
    dispose()
    expect(registry.list()).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus exec vitest run src/workbench.test.ts`
Expected: FAIL，`Cannot find module './workbench.js'`。

- [ ] **Step 3: 实现注册表**

`packages/octopus/src/workbench.ts`：
```ts
export interface WorkbenchModule {
  id: string
  title: string
  order?: number
  entry: string
}

export interface WorkbenchRegistry {
  register(module: WorkbenchModule): () => void
  list(): WorkbenchModule[]
}

export function createRegistry(): WorkbenchRegistry {
  const modules = new Map<string, WorkbenchModule>()
  return {
    register(module) {
      if (modules.has(module.id)) {
        throw new Error(`[octopus] duplicate workbench module id: ${module.id}`)
      }
      modules.set(module.id, module)
      return () => {
        modules.delete(module.id)
      }
    },
    list() {
      return [...modules.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus exec vitest run src/workbench.test.ts`
Expected: 5 个用例全 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/octopus/src/workbench.ts packages/octopus/src/workbench.test.ts
git commit -m "feat(octopus): add workbench module registry"
```

---

### Task 3: 静态资源服务（static.ts）

**Files:**
- Create: `packages/octopus/src/static.ts`
- Test: `packages/octopus/src/static.test.ts`

**Interfaces:**
- Produces:
  - `export const MIME_TYPES: Record<string, string>`（键为小写扩展名，含 `.html/.js/.css/.svg/.png/.jpg/.jpeg/.ico/.woff2/.json/.map`）
  - `interface HttpRequest { method?: string; url?: string }`
  - `interface HttpResponse { writeHead(status: number, headers?: Record<string, string>): void; end(body?: string | Uint8Array): void }`
  - `function serveStaticFiles(rootDir: string, basePath: string): (req, res) => Promise<void>`
    - 非 GET/HEAD → 405；URL 解析失败或非法 % 编码 → 400；pathname 不以 `basePath + "/"` 开头 → 404；`resolve` 后逃逸 root → 403；文件不存在 → 404；成功 → 200 + 对应 MIME（未知扩展名 `application/octet-stream`）+ `content-length`；HEAD 不写 body

- [ ] **Step 1: 写失败测试**

`packages/octopus/src/static.test.ts`：
```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { serveStaticFiles } from "./static.js"

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

describe("serveStaticFiles", () => {
  const root = mkdtempSync(join(tmpdir(), "octopus-static-"))
  writeFileSync(join(root, "index.js"), "console.log(1)")
  writeFileSync(join(root, "app.css"), "body {}")
  writeFileSync(join(root, "blob.bin"), "\u0000\u0001")
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const handler = serveStaticFiles(root, "/workbench/assets")

  it("serves a file with correct content-type", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/index.js" }, res)
    expect(res.calls[0].status).toBe(200)
    expect(res.calls[0].headers["content-type"]).toBe("text/javascript; charset=utf-8")
    expect(res.calls[0].body).toBe("console.log(1)")
  })

  it("serves unknown extensions as octet-stream", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/blob.bin" }, res)
    expect(res.calls[0].headers["content-type"]).toBe("application/octet-stream")
  })

  it("HEAD returns headers without body", async () => {
    const res = createRes()
    await handler({ method: "HEAD", url: "/workbench/assets/index.js" }, res)
    expect(res.calls[0].status).toBe(200)
    expect(res.calls[0].body).toBe("")
  })

  it("rejects non-GET/HEAD methods", async () => {
    const res = createRes()
    await handler({ method: "POST", url: "/workbench/assets/index.js" }, res)
    expect(res.calls[0].status).toBe(405)
  })

  it("rejects traversal outside the root", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/..%2F..%2Fpackage.json" }, res)
    expect(res.calls[0].status).toBe(403)
  })

  it("returns 404 for missing files", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/nope.js" }, res)
    expect(res.calls[0].status).toBe(404)
  })

  it("returns 404 for paths outside the base", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/other/index.js" }, res)
    expect(res.calls[0].status).toBe(404)
  })

  it("returns 400 for malformed percent encoding", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/%zz" }, res)
    expect(res.calls[0].status).toBe(400)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus exec vitest run src/static.test.ts`
Expected: FAIL，`Cannot find module './static.js'`。

- [ ] **Step 3: 实现静态服务**

`packages/octopus/src/static.ts`：
```ts
import { readFile } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"

export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
}

export interface HttpRequest {
  method?: string
  url?: string
}

export interface HttpResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

export function serveStaticFiles(rootDir: string, basePath: string) {
  const root = resolve(rootDir)
  return async function handler(req: HttpRequest, res: HttpResponse) {
    const method = (req.method ?? "GET").toUpperCase()
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" })
      res.end("method not allowed")
      return
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" })
      res.end("bad request")
      return
    }
    if (!pathname.startsWith(basePath + "/")) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      res.end("not found")
      return
    }
    const abs = resolve(root, "." + pathname.slice(basePath.length))
    if (abs !== root && !abs.startsWith(root + sep)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" })
      res.end("forbidden")
      return
    }
    let content: Buffer
    try {
      content = await readFile(abs)
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      res.end("not found")
      return
    }
    const type = MIME_TYPES[extname(abs).toLowerCase()] ?? "application/octet-stream"
    res.writeHead(200, {
      "content-type": type,
      "content-length": String(content.length),
    })
    if (method === "HEAD") {
      res.end()
      return
    }
    res.end(content)
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus exec vitest run src/static.test.ts`
Expected: 8 个用例全 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/octopus/src/static.ts packages/octopus/src/static.test.ts
git commit -m "feat(octopus): add static file serving with MIME and traversal guards"
```

---

### Task 4: octopus 壳插件入口（index.ts）

**Files:**
- Create: `packages/octopus/src/index.ts`
- Test: `packages/octopus/src/index.test.ts`

**Interfaces:**
- Consumes: `createRegistry`/`WorkbenchRegistry`（Task 2）、`serveStaticFiles`/`HttpRequest`/`HttpResponse`（Task 3）
- Produces（octopus 包对外导出）：
  - `export const name = "octopus"`；`export const inject = ["webServer"]`
  - `export const Config`（schemastery object：`title` 默认 `"My Workbench"`、`greeting` 默认 `""`）
  - `export const DEFAULT_CONFIG = { title: "My Workbench", greeting: "" }`
  - `export function resolveConfig(config?: Partial<typeof DEFAULT_CONFIG>): typeof DEFAULT_CONFIG` — 与默认值合并
  - `export interface WebServerRoute { kind: "exact" | "prefix"; path: string; handler: (req: HttpRequest, res: HttpResponse) => Promise<void> }`
  - `export interface WebServerLike { register(route: WebServerRoute): () => void }`
  - `export default { name, inject, Config, apply }`
  - `declare module "@deepseek-ai/cordis" { interface Context { workbench: WorkbenchRegistry; webServer: WebServerLike } }`
- `apply(ctx, config)`：`ctx.provide("workbench", registry)`；`ctx.effect` 内注册 4 条路由（`/workbench`、`/workbench/assets`、`/api/octopus/config`、`/api/octopus/modules`），effect 返回的 disposer 依次调用各 register 返回的 disposer；`web-dist` 缺失时 `/workbench` 返回 503 与提示文本；modules API 每次请求时取 `registry.list()`

- [ ] **Step 1: 写失败测试**

`packages/octopus/src/index.test.ts`：
```ts
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { apply, resolveConfig } from "./index.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const hasDist = existsSync(join(HERE, "..", "web-dist", "index.html"))

function mockContext() {
  const disposers: (() => void)[] = []
  const register = vi.fn(() => {
    const dispose = vi.fn()
    disposers.push(dispose)
    return dispose
  })
  const webServer = { register }
  let disposeAll: (() => void) | undefined
  const ctx: any = {
    provide: vi.fn(),
    get: vi.fn(() => webServer),
    webServer,
    effect: vi.fn((factory: () => () => void) => {
      disposeAll = factory()
    }),
  }
  return { ctx, webServer, disposers, getDisposeAll: () => disposeAll }
}

describe("resolveConfig", () => {
  it("returns defaults when config is empty", () => {
    expect(resolveConfig({})).toEqual({ title: "My Workbench", greeting: "" })
  })

  it("merges partial config over defaults", () => {
    expect(resolveConfig({ title: "我的工作台" })).toEqual({ title: "我的工作台", greeting: "" })
  })
})

describe("apply", () => {
  it("provides the workbench service", () => {
    const { ctx } = mockContext()
    apply(ctx, {})
    expect(ctx.provide).toHaveBeenCalledWith("workbench", expect.objectContaining({
      register: expect.any(Function),
      list: expect.any(Function),
    }))
  })

  it("registers the four routes", () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, {})
    const paths = webServer.register.mock.calls.map(([route]: any[]) => [route.kind, route.path])
    expect(paths).toEqual([
      ["exact", "/workbench"],
      ["prefix", "/workbench/assets"],
      ["exact", "/api/octopus/config"],
      ["exact", "/api/octopus/modules"],
    ])
  })

  it("serves config and modules JSON from the api routes", async () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, { title: "我的工作台", greeting: "欢迎" })
    const registry = ctx.provide.mock.calls[0][1]
    registry.register({ id: "demo", title: "Demo", entry: "/demo.js" })
    const configRoute = webServer.register.mock.calls[2][0]
    const modulesRoute = webServer.register.mock.calls[3][0]
    const res: any = { calls: [], writeHead(s: number, h: any) { this.calls.push({ s, h, body: "" }) }, end(b: string) { this.calls[0].body += b } }
    await configRoute.handler({ method: "GET", url: "/api/octopus/config" }, res)
    expect(res.calls[0].s).toBe(200)
    expect(JSON.parse(res.calls[0].body)).toEqual({ title: "我的工作台", greeting: "欢迎" })
    await modulesRoute.handler({ method: "GET", url: "/api/octopus/modules" }, res)
    expect(res.calls[1].s).toBe(200)
    expect(JSON.parse(res.calls[1].body).map((m: any) => m.id)).toEqual(["demo"])
  })

  it("returns 503 with build hint when web-dist is missing", async () => {
    const { ctx, webServer } = mockContext()
    apply(ctx, {})
    const route = webServer.register.mock.calls[0][0]
    const res: any = { calls: [], writeHead(s: number, h: any) { this.calls.push({ s, h, body: "" }) }, end(b: string) { this.calls[0].body += b } }
    await route.handler({ method: "GET", url: "/workbench" }, res)
    if (hasDist) {
      expect(res.calls[0].s).toBe(200)
    } else {
      expect(res.calls[0].s).toBe(503)
      expect(res.calls[0].body).toContain("web-dist")
    }
  })

  it("disposes all route registrations", () => {
    const { ctx, disposers, getDisposeAll } = mockContext()
    apply(ctx, {})
    const disposeAll = getDisposeAll()!
    expect(disposeAll).toBeDefined()
    disposeAll()
    for (const dispose of disposers) expect(dispose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus exec vitest run src/index.test.ts`
Expected: FAIL，`Cannot find module './index.js'`。

- [ ] **Step 3: 实现壳插件**

`packages/octopus/src/index.ts`：
```ts
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { createRegistry, type WorkbenchRegistry } from "./workbench.js"
import { serveStaticFiles, type HttpRequest, type HttpResponse } from "./static.js"

export const name = "octopus"
export const inject = ["webServer"]

export const Config = z.object({
  title: z.string().default("My Workbench"),
  greeting: z.string().default(""),
})

export const DEFAULT_CONFIG = { title: "My Workbench", greeting: "" }

export function resolveConfig(config: Partial<typeof DEFAULT_CONFIG> = {}): typeof DEFAULT_CONFIG {
  return { ...DEFAULT_CONFIG, ...config }
}

export interface WebServerRoute {
  kind: "exact" | "prefix"
  path: string
  handler: (req: HttpRequest, res: HttpResponse) => Promise<void>
}

export interface WebServerLike {
  register(route: WebServerRoute): () => void
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    workbench: WorkbenchRegistry
    webServer: WebServerLike
  }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(HERE, "..", "web-dist")

function jsonHandler(getValue: () => unknown) {
  return async function (_req: HttpRequest, res: HttpResponse) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
    res.end(JSON.stringify(getValue()))
  }
}

async function serveIndex(_req: HttpRequest, res: HttpResponse) {
  try {
    const html = await readFile(join(DIST_DIR, "index.html"), "utf8")
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(html)
  } catch {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
    res.end("[octopus] web-dist 未构建：请在 packages/octopus 运行 pnpm build")
  }
}

export function apply(ctx: Context, config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const effective = resolveConfig(config)
  const registry = createRegistry()
  ctx.provide("workbench", registry)
  const webServer = (ctx.webServer ?? ctx.get?.("webServer")) as WebServerLike | undefined
  if (!webServer) return
  ctx.effect(() => {
    const disposers = [
      webServer.register({ kind: "exact", path: "/workbench", handler: serveIndex }),
      webServer.register({
        kind: "prefix",
        path: "/workbench/assets",
        handler: serveStaticFiles(DIST_DIR, "/workbench/assets"),
      }),
      webServer.register({ kind: "exact", path: "/api/octopus/config", handler: jsonHandler(() => effective) }),
      webServer.register({ kind: "exact", path: "/api/octopus/modules", handler: jsonHandler(() => registry.list()) }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

export default { name, inject, Config, apply }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus exec vitest run src/index.test.ts`
Expected: 6 个用例全 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/octopus/src/index.ts packages/octopus/src/index.test.ts
git commit -m "feat(octopus): add shell plugin entry with workbench service and routes"
```

---

### Task 5: 壳前端欢迎页（web/ v1）

**Files:**
- Create: `packages/octopus/web/index.html`、`packages/octopus/web/vite.config.ts`、`packages/octopus/web/vendor.config.ts`、`packages/octopus/web/tsconfig.json`、`packages/octopus/web/vitest.config.ts`、`packages/octopus/web/src/test/setup.ts`
- Create: `packages/octopus/web/src/main.tsx`、`packages/octopus/web/src/App.tsx`、`packages/octopus/web/src/api.ts`、`packages/octopus/web/src/greeting.ts`、`packages/octopus/web/src/styles.css`
- Create: `packages/octopus/web/src/vendor/react.ts`、`packages/octopus/web/src/vendor/react-dom.ts`、`packages/octopus/web/src/vendor/jsx-runtime.ts`
- Test: `packages/octopus/web/src/App.test.tsx`

**Interfaces:**
- Produces:
  - `web/src/api.ts`: `interface WorkbenchConfig { title: string; greeting: string }`；`interface WorkbenchModuleInfo { id: string; title: string; entry: string }`；`async function fetchConfig(): Promise<WorkbenchConfig | null>`；`async function fetchModules(): Promise<WorkbenchModuleInfo[]>`（失败返回 null/[]，不抛出）
  - `web/src/greeting.ts`: `function timeGreeting(hour: number): string`（5–11 早上好 / 11–13 中午好 / 13–18 下午好 / 其余 晚上好）
  - `web/src/App.tsx`: default export `App`，渲染标题（`config?.title ?? "My Workbench"`）、问候（`config?.greeting || timeGreeting(new Date().getHours())`）、三个快捷链接（`/`、`/marketplace`、`/settings`）、`ModuleGrid`
  - `web/src/ModuleGrid.tsx`（Task 6 定义，本任务先不创建；App 中暂不渲染模块区——Task 6 再加入。**修正**：为保持本任务可编译，App 本任务不含 ModuleGrid import，Task 6 统一替换 App.tsx）
  - vendor 产物：`web-dist/vendor/react.js`、`web-dist/vendor/react-dom.js`、`web-dist/vendor/jsx-runtime.js`（自包含 ESM，供模块 bundle 外部引用）
  - 构建命令：`vite build --config web/vite.config.ts`（SPA → `web-dist/`，base `/workbench/`）再 `vite build --config web/vendor.config.ts`（vendor → `web-dist/vendor/`，emptyOutDir false）

- [ ] **Step 1: 写失败测试**

`packages/octopus/web/src/test/setup.ts`：
```ts
import "@testing-library/jest-dom/vitest"
```

`packages/octopus/web/src/App.test.tsx`：
```tsx
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { fetchConfig } from "./api"
import { timeGreeting } from "./greeting"

vi.mock("./api", () => ({
  fetchConfig: vi.fn(),
  fetchModules: vi.fn(),
}))

const mockedFetchConfig = vi.mocked(fetchConfig)

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("renders default title and time greeting when config fails", async () => {
    mockedFetchConfig.mockResolvedValue(null)
    render(<App />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My Workbench")
    expect(screen.getByText("早上好")).toBeInTheDocument()
  })

  it("uses config title and greeting when provided", async () => {
    mockedFetchConfig.mockResolvedValue({ title: "我的工作台", greeting: "欢迎回来" })
    render(<App />)
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("我的工作台")
    expect(screen.getByText("欢迎回来")).toBeInTheDocument()
  })

  it("renders quick links", () => {
    render(<App />)
    expect(screen.getByRole("link", { name: "进入主界面" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("link", { name: "插件市场" })).toHaveAttribute("href", "/marketplace")
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute("href", "/settings")
  })
})

describe("timeGreeting", () => {
  it("greets by hour ranges", () => {
    expect(timeGreeting(7)).toBe("早上好")
    expect(timeGreeting(12)).toBe("中午好")
    expect(timeGreeting(15)).toBe("下午好")
    expect(timeGreeting(22)).toBe("晚上好")
    expect(timeGreeting(3)).toBe("晚上好")
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus exec vitest run --config web/vitest.config.ts`
Expected: FAIL，`Cannot find module './App'`。

- [ ] **Step 3: 实现配置/问候/API 与页面**

`packages/octopus/web/src/api.ts`：
```ts
export interface WorkbenchConfig {
  title: string
  greeting: string
}

export interface WorkbenchModuleInfo {
  id: string
  title: string
  entry: string
}

export async function fetchConfig(): Promise<WorkbenchConfig | null> {
  try {
    const res = await fetch("/api/octopus/config")
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function fetchModules(): Promise<WorkbenchModuleInfo[]> {
  try {
    const res = await fetch("/api/octopus/modules")
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}
```

`packages/octopus/web/src/greeting.ts`：
```ts
export function timeGreeting(hour: number): string {
  if (hour >= 5 && hour < 11) return "早上好"
  if (hour >= 11 && hour < 13) return "中午好"
  if (hour >= 13 && hour < 18) return "下午好"
  return "晚上好"
}
```

`packages/octopus/web/src/App.tsx`（本任务版本，Task 6 将替换）：
```tsx
import { useEffect, useState } from "react"
import { fetchConfig, type WorkbenchConfig } from "./api"
import { timeGreeting } from "./greeting"

const DEFAULT_TITLE = "My Workbench"

export default function App() {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null)
  useEffect(() => {
    void fetchConfig().then(setConfig)
  }, [])
  const greeting = config?.greeting || timeGreeting(new Date().getHours())
  return (
    <main className="shell">
      <header className="hero">
        <h1>{config?.title ?? DEFAULT_TITLE}</h1>
        <p className="greeting">{greeting}</p>
      </header>
      <nav className="links">
        <a href="/">进入主界面</a>
        <a href="/marketplace">插件市场</a>
        <a href="/settings">设置</a>
      </nav>
    </main>
  )
}
```

`packages/octopus/web/src/main.tsx`：
```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`packages/octopus/web/src/styles.css`：
```css
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --card: #f4f4f5;
  --accent: #4c5df5;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #18181b;
    --fg: #f4f4f5;
    --card: #27272a;
    --accent: #818cf8;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}

.shell {
  max-width: 960px;
  margin: 0 auto;
  padding: 64px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.hero {
  text-align: center;
}

.hero h1 {
  margin: 0;
  font-size: 40px;
}

.hero .greeting {
  margin: 8px 0 0;
  font-size: 20px;
  opacity: 0.75;
}

.links {
  display: flex;
  gap: 12px;
}

.links a {
  color: var(--accent);
  text-decoration: none;
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 8px 16px;
}

.links a:hover {
  background: var(--accent);
  color: var(--bg);
}

.modules {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  width: 100%;
}

.module-card {
  background: var(--card);
  border-radius: 12px;
  padding: 16px;
}

.module-title {
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.module-loading,
.module-error {
  margin-top: 12px;
  font-size: 14px;
  opacity: 0.7;
}

.module-error {
  color: #e5484d;
}
```

`packages/octopus/web/index.html`：
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>工作台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

`packages/octopus/web/vite.config.ts`：
```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  base: "/workbench/",
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
  },
})
```

`packages/octopus/web/vendor.config.ts`：
```ts
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    outDir: "../web-dist/vendor",
    emptyOutDir: false,
    lib: {
      entry: {
        react: "src/vendor/react.ts",
        "react-dom": "src/vendor/react-dom.ts",
        "jsx-runtime": "src/vendor/jsx-runtime.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
})
```

`packages/octopus/web/src/vendor/react.ts`：
```ts
export * from "react"
export { default } from "react"
```

`packages/octopus/web/src/vendor/react-dom.ts`：
```ts
export * from "react-dom"
```

`packages/octopus/web/src/vendor/jsx-runtime.ts`：
```ts
export * from "react/jsx-runtime"
```

`packages/octopus/web/tsconfig.json`：
```jsonc
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
  "include": ["src", "vite.config.ts", "vendor.config.ts", "vitest.config.ts"]
}
```

`packages/octopus/web/vitest.config.ts`：
```ts
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
  },
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus exec vitest run --config web/vitest.config.ts`
Expected: 4 个用例全 PASS。

- [ ] **Step 5: 构建验证（SPA + vendor）**

Run: `pnpm --filter octopus exec vite build --config web/vite.config.ts; pnpm --filter octopus exec vite build --config web/vendor.config.ts`
Expected: 生成 `packages/octopus/web-dist/index.html`、`web-dist/assets/*`、`web-dist/vendor/react.js`、`web-dist/vendor/react-dom.js`、`web-dist/vendor/jsx-runtime.js`；vendor 文件不含裸导入（`Select-String "from \"react\"" web-dist/vendor/*.js` 无裸 `react` 导入）。

- [ ] **Step 6: 提交**

```bash
git add packages/octopus/web packages/octopus/web-dist
git commit -m "feat(octopus): add shell welcome page with vendor builds"
```

---

### Task 6: 壳模块网格与懒加载

**Files:**
- Create: `packages/octopus/web/src/loadModule.ts`、`packages/octopus/web/src/ModuleGrid.tsx`
- Modify: `packages/octopus/web/src/App.tsx`（加入模块区）、`packages/octopus/web/src/App.test.tsx`（补模块用例）、`docs/superpowers/specs/2026-08-25-octopus-workbench-design.md`（补客户端契约 vendor URL 细节）
- Test: `packages/octopus/web/src/ModuleGrid.test.tsx`

**Interfaces:**
- Consumes: `fetchModules`、`WorkbenchModuleInfo`（Task 5）、`timeGreeting`（Task 5）
- Produces:
  - `web/src/loadModule.ts`: `export function loadModule(entry: string): Promise<{ default: ComponentType }>`（`import(/* @vite-ignore */ entry)`）
  - `web/src/ModuleGrid.tsx`: default export `ModuleGrid({ modules }: { modules: WorkbenchModuleInfo[] })`；空数组渲染 null；每模块渲染 `ModuleCard`（按钮显示 `module.title`，点击后用 `useMemo(() => lazy(() => loadModule(module.entry)), [module.entry])` 懒加载，`Suspense` fallback "加载中…"，`ModuleErrorBoundary` 捕获失败显示 `模块 <title> 加载失败`）

- [ ] **Step 1: 写失败测试**

`packages/octopus/web/src/ModuleGrid.test.tsx`：
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import ModuleGrid from "./ModuleGrid"
import { loadModule } from "./loadModule"

vi.mock("./loadModule", () => ({
  loadModule: vi.fn(),
}))

const mockedLoadModule = vi.mocked(loadModule)

describe("ModuleGrid", () => {
  it("renders nothing when there are no modules", () => {
    const { container } = render(<ModuleGrid modules={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders a card per module and lazy-loads its bundle on click", async () => {
    const Comp = () => <div>已加载</div>
    mockedLoadModule.mockResolvedValue({ default: Comp })
    render(<ModuleGrid modules={[{ id: "quickstart", title: "快捷入口", entry: "/octopus/quickstart/assets/index.js" }]} />)
    const button = screen.getByRole("button", { name: "快捷入口" })
    expect(button).toBeInTheDocument()
    await userEvent.click(button)
    expect(await screen.findByText("已加载")).toBeInTheDocument()
    expect(mockedLoadModule).toHaveBeenCalledWith("/octopus/quickstart/assets/index.js")
  })

  it("shows an error placeholder when the bundle fails to load", async () => {
    mockedLoadModule.mockRejectedValue(new Error("boom"))
    render(<ModuleGrid modules={[{ id: "quickstart", title: "快捷入口", entry: "/broken.js" }]} />)
    await userEvent.click(screen.getByRole("button", { name: "快捷入口" }))
    expect(await screen.findByText("模块 快捷入口 加载失败")).toBeInTheDocument()
  })
})
```

（`@testing-library/user-event` 需加入 octopus 包 devDependencies：`"@testing-library/user-event": "^14.5.0"`，修改 `packages/octopus/package.json` 后运行 `pnpm install`。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus exec vitest run --config web/vitest.config.ts src/ModuleGrid.test.tsx`
Expected: FAIL，`Cannot find module './ModuleGrid'`。

- [ ] **Step 3: 实现懒加载与模块网格**

`packages/octopus/web/src/loadModule.ts`：
```ts
import type { ComponentType } from "react"

export function loadModule(entry: string): Promise<{ default: ComponentType }> {
  return import(/* @vite-ignore */ entry)
}
```

`packages/octopus/web/src/ModuleGrid.tsx`：
```tsx
import { lazy, Suspense, useMemo, useState, Component, type ReactNode } from "react"
import { loadModule } from "./loadModule"
import type { WorkbenchModuleInfo } from "./api"

interface ModuleCardProps {
  module: WorkbenchModuleInfo
}

function ModuleError({ title }: { title: string }) {
  return <div className="module-error">模块 {title} 加载失败</div>
}

class ModuleErrorBoundary extends Component<{ children: ReactNode; title: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return <ModuleError title={this.props.title} />
    return this.props.children
  }
}

function ModuleCard({ module }: ModuleCardProps) {
  const [open, setOpen] = useState(false)
  const Lazy = useMemo(() => lazy(() => loadModule(module.entry)), [module.entry])
  return (
    <section className="module-card">
      <button type="button" className="module-title" onClick={() => setOpen((v) => !v)}>
        {module.title}
      </button>
      {open && (
        <ModuleErrorBoundary title={module.title}>
          <Suspense fallback={<div className="module-loading">加载中…</div>}>
            <Lazy />
          </Suspense>
        </ModuleErrorBoundary>
      )}
    </section>
  )
}

export default function ModuleGrid({ modules }: { modules: WorkbenchModuleInfo[] }) {
  if (modules.length === 0) return null
  return (
    <section className="modules">
      {modules.map((module) => (
        <ModuleCard key={module.id} module={module} />
      ))}
    </section>
  )
}
```

- [ ] **Step 4: 更新 App.tsx 加入模块区**

`packages/octopus/web/src/App.tsx`（整体替换）：
```tsx
import { useEffect, useState } from "react"
import { fetchConfig, fetchModules, type WorkbenchConfig, type WorkbenchModuleInfo } from "./api"
import { timeGreeting } from "./greeting"
import ModuleGrid from "./ModuleGrid"

const DEFAULT_TITLE = "My Workbench"

export default function App() {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null)
  const [modules, setModules] = useState<WorkbenchModuleInfo[]>([])
  useEffect(() => {
    void fetchConfig().then(setConfig)
    void fetchModules().then(setModules)
  }, [])
  const greeting = config?.greeting || timeGreeting(new Date().getHours())
  return (
    <main className="shell">
      <header className="hero">
        <h1>{config?.title ?? DEFAULT_TITLE}</h1>
        <p className="greeting">{greeting}</p>
      </header>
      <nav className="links">
        <a href="/">进入主界面</a>
        <a href="/marketplace">插件市场</a>
        <a href="/settings">设置</a>
      </nav>
      <ModuleGrid modules={modules} />
    </main>
  )
}
```

- [ ] **Step 5: 更新 App.test.tsx 的 api mock 并补模块渲染用例**

在 `App.test.tsx` 顶部 `vi.mock("./api", ...)` 中补充 `fetchModules: vi.fn()`，并新增用例：
```tsx
it("renders module cards from the modules api", async () => {
  const { fetchModules } = await import("./api")
  vi.mocked(fetchModules).mockResolvedValue([
    { id: "quickstart", title: "快捷入口", entry: "/octopus/quickstart/assets/index.js" },
  ])
  render(<App />)
  expect(await screen.findByRole("button", { name: "快捷入口" })).toBeInTheDocument()
})
```
（模块加载链路已由 ModuleGrid.test.tsx 覆盖。）

- [ ] **Step 6: 运行全部 web 测试确认通过**

Run: `pnpm --filter octopus exec vitest run --config web/vitest.config.ts`
Expected: 全部 PASS（App 4 例 + ModuleGrid 3 例）。

- [ ] **Step 7: 更新 spec 的客户端契约细节**

在 `docs/superpowers/specs/2026-08-25-octopus-workbench-design.md` 的"客户端契约"段落后追加：

> **React 共享细节**：浏览器 ESM 不支持裸导入，模块 bundle 通过构建期 resolveId 插件将 `react`、`react-dom`、`react/jsx-runtime` 改写为壳托管的 vendor URL（`/workbench/assets/vendor/{react,react-dom,jsx-runtime}.js`，由壳构建时从依赖打包为自包含 ESM）。功能插件构建模块时须使用该改写插件（见 octopus-quickstart 的 `web/vite.config.ts`）。

- [ ] **Step 8: 重新构建并提交**

Run: `pnpm --filter octopus exec vite build --config web/vite.config.ts`
Expected: 构建成功。

```bash
git add -A packages/octopus docs
git commit -m "feat(octopus): add module grid with lazy loading and error fallback"
```

---

### Task 7: octopus-quickstart 宿主插件

**Files:**
- Create: `packages/octopus-quickstart/src/index.ts`
- Test: `packages/octopus-quickstart/src/index.test.ts`

**Interfaces:**
- Consumes: `octopus` 包导出 `serveStaticFiles`、`WorkbenchRegistry`、`WebServerLike`（Task 4 产物）
- Produces:
  - `export const name = "octopus-quickstart"`；`export const inject = ["workbench", "webServer"]`
  - `export function apply(ctx)`：`ctx.effect` 内 `ctx.workbench.register({ id: "quickstart", title: "快捷入口", order: 10, entry: "/octopus/quickstart/assets/index.js" })` + `ctx.webServer.register({ kind: "prefix", path: "/octopus/quickstart/assets", handler: serveStaticFiles(DIST_DIR, "/octopus/quickstart/assets") })`，DIST_DIR = `join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist")`
  - `export default { name, inject, apply }`

- [ ] **Step 1: 写失败测试**

`packages/octopus-quickstart/src/index.test.ts`：
```ts
import { describe, expect, it, vi } from "vitest"
import { apply } from "./index.js"

function mockContext() {
  const disposers: (() => void)[] = []
  const workbench = {
    register: vi.fn(() => {
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    }),
  }
  const webServer = {
    register: vi.fn(() => {
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    }),
  }
  let disposeAll: (() => void) | undefined
  const ctx: any = {
    workbench,
    webServer,
    effect: vi.fn((factory: () => () => void) => {
      disposeAll = factory()
    }),
  }
  return { ctx, workbench, webServer, disposers, getDisposeAll: () => disposeAll }
}

describe("octopus-quickstart", () => {
  it("registers the quickstart module with the exact contract", () => {
    const { ctx, workbench } = mockContext()
    apply(ctx)
    expect(workbench.register).toHaveBeenCalledWith({
      id: "quickstart",
      title: "快捷入口",
      order: 10,
      entry: "/octopus/quickstart/assets/index.js",
    })
  })

  it("serves its bundle under the module assets prefix", () => {
    const { ctx, webServer } = mockContext()
    apply(ctx)
    expect(webServer.register).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "prefix",
        path: "/octopus/quickstart/assets",
        handler: expect.any(Function),
      }),
    )
  })

  it("disposes both registrations", () => {
    const { ctx, disposers, getDisposeAll } = mockContext()
    apply(ctx)
    const disposeAll = getDisposeAll()!
    expect(disposeAll).toBeDefined()
    disposeAll()
    for (const dispose of disposers) expect(dispose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus-quickstart exec vitest run src/index.test.ts`
Expected: FAIL，`Cannot find module './index.js'`。

- [ ] **Step 3: 实现插件**

`packages/octopus-quickstart/src/index.ts`：
```ts
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "@deepseek-ai/cordis"
import { serveStaticFiles, type WebServerLike, type WorkbenchRegistry } from "octopus"

export const name = "octopus-quickstart"
export const inject = ["workbench", "webServer"]

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(HERE, "..", "web", "dist")

declare module "@deepseek-ai/cordis" {
  interface Context {
    workbench: WorkbenchRegistry
    webServer: WebServerLike
  }
}

export function apply(ctx: Context) {
  ctx.effect(() => {
    const disposers = [
      ctx.workbench.register({
        id: "quickstart",
        title: "快捷入口",
        order: 10,
        entry: "/octopus/quickstart/assets/index.js",
      }),
      ctx.webServer.register({
        kind: "prefix",
        path: "/octopus/quickstart/assets",
        handler: serveStaticFiles(DIST_DIR, "/octopus/quickstart/assets"),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

export default { name, inject, apply }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter octopus-quickstart exec vitest run src/index.test.ts`
Expected: 3 个用例全 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/octopus-quickstart/src
git commit -m "feat(octopus-quickstart): add host plugin registering the quickstart module"
```

---

### Task 8: octopus-quickstart 模块 bundle

**Files:**
- Create: `packages/octopus-quickstart/web/vite.config.ts`、`packages/octopus-quickstart/web/tsconfig.json`、`packages/octopus-quickstart/web/src/index.tsx`

**Interfaces:**
- Produces: `web/dist/index.js`（ES module，default export React 组件 `Quickstart`，`react` 系列导入改写为 vendor URL）

- [ ] **Step 1: 写模块组件与构建配置**

`packages/octopus-quickstart/web/src/index.tsx`：
```tsx
export default function Quickstart() {
  const links = [
    { label: "进入主界面", href: "/" },
    { label: "插件市场", href: "/marketplace" },
    { label: "设置", href: "/settings" },
  ]
  return (
    <ul className="quickstart">
      {links.map((link) => (
        <li key={link.href}>
          <a href={link.href}>{link.label}</a>
        </li>
      ))}
    </ul>
  )
}
```

`packages/octopus-quickstart/web/vite.config.ts`：
```ts
import type { Plugin } from "vite"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const VENDOR = {
  react: "/workbench/assets/vendor/react.js",
  "react-dom": "/workbench/assets/vendor/react-dom.js",
  "react/jsx-runtime": "/workbench/assets/vendor/jsx-runtime.js",
}

function octopusVendor(): Plugin {
  return {
    name: "octopus-vendor",
    resolveId(source, importer, options) {
      if (options?.isEntry) return null
      if (source in VENDOR) {
        return { id: VENDOR[source as keyof typeof VENDOR], external: true }
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [react(), octopusVendor()],
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

`packages/octopus-quickstart/web/tsconfig.json`：
```jsonc
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
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 2: 构建并验证产物**

Run: `pnpm --filter octopus-quickstart exec vite build --config web/vite.config.ts`
Expected: 生成 `packages/octopus-quickstart/web/dist/index.js`。

验证（PowerShell，仓库根）：
```powershell
Select-String -Path "packages/octopus-quickstart/web/dist/index.js" -Pattern "/workbench/assets/vendor/" | Measure-Object | Select-Object -ExpandProperty Count
Select-String -Path "packages/octopus-quickstart/web/dist/index.js" -Pattern "export default"
```
Expected: 两个计数均 ≥ 1（产物含 vendor URL 引用与 default export）。

- [ ] **Step 3: 提交**

```bash
git add packages/octopus-quickstart/web packages/octopus-quickstart/web/dist
git commit -m "feat(octopus-quickstart): add module client bundle with vendor externalization"
```

---

### Task 9: 根脚本、README 与端到端联调

**Files:**
- Create: `README.md`（根）、`packages/octopus/README.md`、`packages/octopus-quickstart/README.md`
- Modify: `docs/superpowers/specs/2026-08-25-octopus-workbench-design.md`（dev 脚本补充 `--config.auto-install-peers=false` 说明）

**Interfaces:**
- Consumes: Task 1–8 全部产物
- Produces: `pnpm dev` / `pnpm dev:noopen` 可用的验证结果；README 文档

- [ ] **Step 1: 更新 spec 启动章节说明**

在 spec "启动（一行命令）"章节的 `dev` 脚本后追加一行：

> `--config.auto-install-peers=false`：octopus 尚未发布到 npm，禁止 pnpm 在 profile 中尝试从 registry 自动安装 peer（同一次 add 已包含本地 octopus，peer 在安装图中满足）。

- [ ] **Step 2: 写 README**

`README.md`（根）：
```markdown
# octopus

DeepSeek Harness 个人专属工作台：壳插件 `octopus` + 功能插件（当前为 `octopus-quickstart`）。

## 快速开始

```sh
pnpm dev        # 一键：安装依赖 → 构建 → 挂载插件 → 启动 dsh web
pnpm dev:noopen # 同上但不打开浏览器
```

启动后访问 `http://127.0.0.1:3080/workbench`。

## 结构

- `packages/octopus`：工作台壳插件，提供 `ctx.workbench` 服务契约与 `/workbench` 页面
- `packages/octopus-quickstart`：示例功能插件，验证模块注册与懒加载链路

## 新增功能插件

1. 复制 `packages/octopus-quickstart` 目录结构（改包名/插件 id）
2. `src/index.ts` 中 `ctx.workbench.register({ id, title, order, entry })` 并自托管模块 bundle
3. 模块 bundle 构建须使用 vendor 改写插件（见 quickstart 的 `web/vite.config.ts`）
4. 根 `package.json` 的 `dev`/`dev:noopen` 脚本追加 `./packages/<新包>`
5. `pnpm dev` 生效

## 测试与构建

```sh
pnpm test   # 全部单测
pnpm build  # 全部构建
```
```

`packages/octopus/README.md`：
```markdown
# octopus

DeepSeek Harness 工作台壳插件。提供 `ctx.workbench` 服务（`register`/`list`）与 `/workbench` 独立页面，页面动态加载各功能插件注册的模块。
```

`packages/octopus-quickstart/README.md`：
```markdown
# octopus-quickstart

octopus 工作台的示例功能插件：注册"快捷入口"模块并自托管其客户端 bundle。
```

- [ ] **Step 3: 全量构建与测试**

Run: `pnpm build`
Expected: 所有包构建成功（octopus: lib/ + web-dist/；octopus-quickstart: lib/ + web/dist/）。

Run: `pnpm test`
Expected: 全部单测 PASS（octopus host 20 例 [workbench 5 + static 8 + index 7] + octopus web 7 例 [App 4 + ModuleGrid 3] + quickstart 3 例）。

- [ ] **Step 4: 安装插件到 profile**

Run: `pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-quickstart --config.auto-install-peers=false`
Expected: 成功；`$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles` 包含 `octopus` 与 `octopus-quickstart`。

- [ ] **Step 5: 启动服务器并验证端点**

PowerShell（仓库根）：
```powershell
$log = "$env:TEMP\octopus-dsh.log"
$server = Start-Process -FilePath "pnpm" -ArgumentList "dsh","web","--no-open" -PassThru -RedirectStandardOutput $log
$ok = $false
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 2
  try { if ((curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3080/workbench) -eq "200") { $ok = $true; break } } catch {}
}
if (-not $ok) { Get-Content $log -ErrorAction SilentlyContinue; Stop-Process -Id $server.Id -Force; throw "dsh web did not come up" }
```

验证输出（依次执行并核对）：
1. `curl.exe -s http://127.0.0.1:3080/api/octopus/config` → `{"title":"My Workbench","greeting":""}`
2. `curl.exe -s http://127.0.0.1:3080/api/octopus/modules` → 包含 `"id":"quickstart"` 与 entry `/octopus/quickstart/assets/index.js`
3. `curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3080/octopus/quickstart/assets/index.js` → `200`
4. `curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3080/workbench/assets/vendor/react.js` → `200`
5. `curl.exe --path-as-is -s -o NUL -w "%{http_code}" "http://127.0.0.1:3080/workbench/assets/..%2F..%2Fpackage.json"` → `403`
6. `curl.exe -s http://127.0.0.1:3080/workbench` → 含 `<div id="root">`

清理：
```powershell
Stop-Process -Id $server.Id -Force
```

- [ ] **Step 6: 浏览器人工确认（可选但推荐）**

Run: `pnpm dev:noopen`，手动打开 `http://127.0.0.1:3080/workbench`
Expected: 欢迎卡片（标题 My Workbench + 时段问候）、三个快捷链接、快捷入口卡片可点击展开显示三个链接。开发者工具 Console 无报错。

- [ ] **Step 7: 提交**

```bash
git add README.md packages/octopus/README.md packages/octopus-quickstart/README.md docs
git commit -m "docs: add README and e2e notes"
```

---

## 自审记录

- **Spec 覆盖**：服务契约（Task 2/4）、仓库结构（Task 1）、插件协议（Task 1）、壳路由与失败边界（Task 4）、欢迎页（Task 5）、模块网格与懒加载（Task 6）、功能插件宿主（Task 7）、模块 bundle（Task 8）、一行启动（Task 9）、测试（各任务 TDD + Task 9 E2E）。契约中的 vendor URL 细节已通过 Task 6 Step 7 同步回 spec。
- **占位符**：无 TBD/TODO；所有代码块为可直接执行的完整内容。
- **类型一致性**：`createRegistry`/`serveStaticFiles`/`resolveConfig`/`loadModule`/`fetchConfig`/`fetchModules`/`timeGreeting` 的签名在各任务间一致；entry URL 均为 `/octopus/quickstart/assets/index.js`；vendor URL 在 Task 5 构建与 Task 8 改写插件中一致（`/workbench/assets/vendor/…`）。
