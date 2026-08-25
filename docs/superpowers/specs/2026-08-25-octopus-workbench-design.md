# octopus — 个人专属工作台插件 设计文档

- 日期：2026-08-25
- 状态：已批准（包名 `octopus`、插件 id `octopus`；架构为"壳 + 功能插件"的解耦设计）

## 目标

构建一个 DeepSeek Harness（dsh）第三方插件 **`octopus`**：个人专属工作台壳（shell），提供独立页面 `/workbench`。v1 交付欢迎页框架；后续所有功能通过**独立功能插件**接入，与 deepseek-harness"一切皆是插件"的思想一致。

## 架构原则

- **octopus = 壳插件**：提供 `ctx.workbench` 服务契约 + 工作台页面框架 + 配置/模块 API。壳本身不实现任何业务功能。
- **功能 = 独立 npm 包插件**（如 `octopus-quickstart`）：Host 端注册模块 + 自托管客户端 bundle；壳页面动态懒加载。
- **即插即拆**：装插件即多一个模块卡片，卸插件即还原，不修改任何源码与壳。
- **失败隔离**：模块加载失败不破坏壳；壳缺失时功能插件明确失败。

## 非目标（v1）

- 不注入/修改现有 DSH Web UI（仅独立页面）
- 不占用 webserver 的 fallback 席位（该席位属于 dsh-web-app 的 dist）
- 不做复杂数据 API，欢迎页为静态内容 + 极少量配置
- 不做认证/网络暴露加固（沿用 webserver 默认 `127.0.0.1`）

## 技术栈

与官方 dsh 前端保持一致：

- Host 端：TypeScript + Cordis 插件（`@deepseek-ai/cordis`），tsc 构建到 `lib/`
- Web 端：React 18 + Vite 6 + TypeScript（官方 `apps/web` 同栈）
- 配置 schema：`@deepseek-ai/schemastery`
- 测试：vitest
- 包管理：pnpm workspace 单仓

## 服务契约（核心解耦点）

`octopus` 通过 `ctx.provide("workbench", api)` 提供服务，类型由 octopus 包导出，功能插件以 peerDependency 引用：

```ts
// octopus 导出（lib/types/workbench.d.ts）
interface WorkbenchModule {
  id: string        // 唯一 id，如 "quickstart"
  title: string     // 卡片标题
  order?: number    // 排序，默认 0
  entry: string     // 模块客户端 bundle 的 URL（同源绝对路径，功能插件自托管）
}

interface WorkbenchRegistry {
  register(module: WorkbenchModule): () => void   // 重复 id 抛错；返回卸载函数
  list(): WorkbenchModule[]                        // 按 order 稳定排序
}
```

**客户端契约**：模块 bundle 为 Vite library mode 构建的 ES module（`external: [react, react-dom]`），**default export 为 React 组件**；壳用 `React.lazy(() => import(entry))` 挂载。

## 仓库结构（pnpm workspace）

```
octopus/                        # monorepo 根
├── pnpm-workspace.yaml
├── package.json             # devDependencies: @deepseek-ai/dsh（本地运行 dsh）
├── packages/
│   ├── octopus/                # 壳插件（包名 octopus，id octopus）
│   │   ├── package.json        # dsh.bundle.patch → cordis.patch.yml
│   │   ├── cordis.patch.yml    # insert { id: octopus, name: octopus }
│   │   ├── src/
│   │   │   ├── index.ts        # apply：provide("workbench") + 路由 + API
│   │   │   ├── workbench.ts    # 契约类型 + 注册表实现
│   │   │   └── static.ts       # 静态资源服务（MIME 表/路径校验）
│   │   └── web/                # React 壳：欢迎卡片 + 模块网格
│   │       ├── vite.config.ts  # base: "/workbench/"，outDir: ../web-dist
│   │       └── src/{main,App}.tsx
│   └── octopus-quickstart/     # 示例功能插件（验证契约端到端）
│       ├── package.json        # 独立包，dsh.bundle.patch
│       ├── cordis.patch.yml    # insert { id: octopus-quickstart, name: octopus-quickstart }
│       ├── src/index.ts        # inject [workbench, webServer]：register + 托管 assets
│       └── web/                # 模块组件 bundle（Vite library mode，external react）
└── docs/
```

## 插件协议

`packages/octopus/package.json` 关键字段（参照 `dsh-harness-zh-cn`）：

```jsonc
{
  "name": "octopus",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" } },
  "files": ["lib", "web-dist", "cordis.patch.yml", "README.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": { "@deepseek-ai/schemastery": "^3.18.1" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" }
}
```

功能插件同构，peerDependencies 增加 `octopus`（取契约类型与运行时服务）。

## Host 端行为

### octopus（壳）

- `name = "octopus"`，`inject = ["webServer"]`
- `Config = z.object({ title: z.string().default("My Workbench"), greeting: z.string().default("") })`
- `apply(ctx, config)`：
  1. `ctx.provide("workbench", registry)`（内部 Map 存模块，重复 id 抛错，注册返回 disposer）
  2. 注册路由（`ctx.effect` 管理 disposer）：
     - `exact /workbench` → `web-dist/index.html`（`text/html; charset=utf-8`）
     - `prefix /workbench/assets` → 静态资源（MIME 表：js/css/svg/png/jpg/ico/woff2/json；路径 `..` 逃逸 403；缺失 404；非 GET/HEAD 405）
     - `exact /api/octopus/config` → `{ title, greeting }`
     - `exact /api/octopus/modules` → `registry.list()`
- 失败边界：`web-dist` 缺失时 `/workbench` 返回 503 并提示 `pnpm build`；`webServer` 缺失时静默跳过

### octopus-quickstart（示例功能插件）

- `name = "octopus-quickstart"`，`inject = ["workbench", "webServer"]`
- `apply(ctx)`：
  1. `ctx.workbench.register({ id: "quickstart", title: "快捷入口", order: 10, entry: "/octopus/quickstart/assets/index.js" })`
  2. 注册 `prefix /octopus/quickstart/assets` → 托管自己的 bundle（复用 octopus 导出的静态服务工具）
- 无 octopus 壳时 `inject` 依赖不满足 → 该插件加载失败但不影响其他插件

## 工作台页面（React 壳）

- `App.tsx`：
  - 时段问候（05–11 早上好 / 11–13 中午好 / 13–18 下午好 / 18–05 晚上好）；Config `greeting` 优先
  - 标题取 Config `title`（`/api/octopus/config` fetch，失败用内置默认值）
  - 模块网格：`/api/octopus/modules` fetch → 卡片列表 → 点击 `React.lazy(() => import(entry))` 挂载；加载失败显示错误占位，不破坏壳
  - 快捷链接：进入主界面 `/`、插件市场、设置
  - 跟随系统深浅色（`prefers-color-scheme`），居中布局，纯 CSS 无 UI 库
- `main.tsx`：ReactDOM.createRoot 挂载；单页无 History API 需求

## 启动（一行命令）

monorepo 根 `package.json` 声明 `devDependencies: { "@deepseek-ai/dsh": "^0.1.1-rc.2" }` 与脚本：

```jsonc
"scripts": {
  "build": "pnpm -r run build",
  "dev": "pnpm install && pnpm build && pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-quickstart && pnpm dsh web",
  "dev:noopen": "pnpm install && pnpm build && pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-quickstart && pnpm dsh web --no-open"
}
```

```sh
pnpm dev        # 一键：装依赖 → 构建 → 挂载插件（幂等）→ 启动 dsh web
```

- 首次克隆：只需 `pnpm dev`，随后浏览器打开 `http://127.0.0.1:3080/workbench`
- `dsh plugin add` 幂等：重复执行只确认依赖，bundle 自动对账挂载，无需手改配置
- 日常迭代：改代码 → `pnpm dev`（file: 符号链接，重启即加载新构建）
- 发布使用：`dsh plugin --profile web add octopus octopus-quickstart`（从 npm registry 安装）

## 测试

- 壳：registry 单测（注册/排序/重复 id 拒绝/disposer）；静态服务单测（MIME、路径逃逸 403、缺失 404、非 GET 405）；Config 默认值
- 功能插件：用 mock workbench 服务测 register 契约
- 壳前端：模块网格渲染、懒加载失败降级（mock fetch）
- 手工联调：`pnpm dsh web` 后访问 `/workbench`，验证欢迎卡片 + quickstart 卡片

## 构建与发布

- 每包 `pnpm build`：tsc → lib/；vite build → web-dist/（壳）或 web/dist/（功能插件 bundle）
- npm 包包含 `lib/`、前端产物、`cordis.patch.yml`；功能插件以 `octopus` 为 peerDependency
- 新功能 = 新功能插件包（结构照抄 octopus-quickstart），`pnpm dsh plugin --profile web add ./packages/<新包>` 即可生效

## 后续迭代（非 v1 范围）

- 更多功能插件：收藏夹、状态仪表盘、快捷启动（quickstart 已是雏形）
- 壳增强：模块页内路由、配置面板（经由 workbench 服务暴露 config 表单）
- 注入现有 UI 的入口链接/小组件
