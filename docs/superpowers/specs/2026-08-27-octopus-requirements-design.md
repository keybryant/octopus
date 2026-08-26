# octopus-requirements — 需求插件 设计文档

- 日期：2026-08-27
- 分支：feature-request（基于 dev）
- 状态：草案，待评审

## 背景与定位

octopus 为"壳 + 功能插件"架构：壳提供 `ctx.workbench` 契约与 `/workbench` 页面，业务功能由独立 npm 包插件承载。

现状（dev 分支）：壳内已有需求 UI（`RequirementsDrawer`、`NewRequirementModal`），但数据全部来自 `web/src/lib/datasource.ts` 的硬编码 mock，状态存于 `App.tsx` 的 `useState`，刷新即失；agent 客户端亦为 mock。与"壳不实现业务功能"的架构原则相悖。

本插件将需求域抽为独立功能插件 `octopus-requirements`，接通真实持久化，注册为 /workbench 模块卡片。

## 目标

1. 需求 CRUD + 状态流转 + 本地持久化（dsh-storage KV）
2. 独立模块页面（Vite library bundle，default export React 组件）
3. 与现有插件协议完全一致：`ctx.workbench.register` + 自托管 assets + `ctx.webServer` 路由

## 非目标（v1）

- 不改壳源码（壳内 mock 抽屉保留，M4 再清理）
- 不做多用户/权限（沿用本地 127.0.0.1）
- 不做任务/看板域（独立插件候选）
- 不做 agent 自动执行需求（预留 source 字段与后续联动）

## 数据模型

```ts
type RequirementStatus = "backlog" | "planned" | "in-progress" | "review" | "done"
type Priority = "P0" | "P1" | "P2"

interface RequirementRecord {
  id: string            // 服务端生成 "REQ-125"
  title: string
  description: string
  priority: Priority
  status: RequirementStatus
  owner: string | null
  source: "manual" | "chat"
  createdAt: string     // ISO
  updatedAt: string
}
```

状态机合法迁移：backlog → planned → in-progress → review → done；done 不可回退；非法迁移返回 422。

## 存储

参照 octopus-users（feature-auth 分支）：

```ts
// src/unit.ts
const REQUESTS_UNIT: KvUnitDescriptor = {
  name: "octopus-requirements", version: 1,
  tables: ["requirements"], hasGlobal: false,
}
```

- `src/store.ts`：RequirementStore，内存 Map 为读源（启动时全量加载），写操作经 WriteChain 串行落 KV
- 待确认：StorageBackend 在 dsh 运行时的注入方式（octopus-users 未接线，M1 首要验证）

## API（webServer 路由）

统一响应 `{ ok: true, data }` / `{ ok: false, error: { code, message } }`：

| Method | Path | 说明 |
|---|---|---|
| GET | /api/octopus-requirements/requirements | 列表，可选 ?status=&priority= |
| POST | /api/octopus-requirements/requirements | 创建（title 必填） |
| GET | /api/octopus-requirements/requirements/:id | 单条 |
| PATCH | /api/octopus-requirements/requirements/:id | 更新（含状态迁移校验） |
| DELETE | /api/octopus-requirements/requirements/:id | 删除 |

注意：壳导出的 HttpRequest 仅有 method/url，POST/PATCH 需读请求流解析 JSON body（req 实为 Node IncomingMessage）。

## 前端模块（web/）

- vite.config.ts 照抄 quickstart：react() + octopusVendor()，library mode → web/dist/index.js
- 页面：工具栏（新建 + 状态筛选）→ 需求列表 → Modal 新建/编辑 → DropdownMenu 改状态
- 组件全部来自 octopus-ui，主题跟随壳
- `web/src/api.ts`：fetch 封装 + 类型；加载/错误/空态三态；变更后重新拉取

## 包结构

```
packages/octopus-requirements/
├── package.json            # peer: cordis, octopus; dep: dsh-storage; dsh.bundle.patch
├── cordis.patch.yml        # insert { id: octopus-requirements, name: octopus-requirements }
├── tsconfig.json / tsconfig.build.json / vitest.config.ts
├── src/
│   ├── index.ts            # apply: inject [workbench, webServer]；路由+模块+assets
│   ├── types.ts            # 模型 + 错误码
│   ├── unit.ts             # KvUnitDescriptor
│   ├── store.ts            # CRUD + WriteChain
│   ├── routes.ts           # REST 处理器
│   └── *.test.ts
└── web/
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/{index.tsx, api.ts}
```

构建：`tsc -p tsconfig.build.json && vite build web --config web/vite.config.ts && tsc -p web/tsconfig.json`
挂载：根 package.json dev/dev:noopen 脚本追加 `./packages/octopus-requirements`（pnpm-workspace.yaml 已 glob packages/*）。

## 测试

- Host：store.test.ts（CRUD、状态机非法迁移、WriteChain 串行）、routes.test.ts（mock webServer）
- Web：组件测试（vitest + testing-library，参照 octopus/web 风格）
- 手动验收：pnpm dev → /workbench 出现"需求管理"卡片 → CRUD → 重启 dsh 数据仍在

## 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | 包骨架 + 存储单元 + store CRUD + 单测（~~确认 StorageBackend 注入~~ 已确认：ctx.storageDomain） | pnpm test 全绿 |
| M2 | REST API + 路由单测 | curl 可完成 CRUD |
| M3 | 前端列表/新建/编辑/删除 + 模块注册 | 浏览器端到端、刷新不丢数据 |
| M4 | 清理壳内 mock 需求 UI（~~chat 联动~~ 推迟，agent 创建需求留待后续） | 壳内无需求 mock ✅ 509a0e2 |
| M5 | README、files 打包、合并 dev 检查 | 可发布形态（未开始） |

## 后续待办（推迟项）

- **chat 联动**：需求插件注册 `create_requirement` DSH 工具（`ctx.tools.register(defineTool(...))`，参照 dsh-tool-todo 模式），让 agent 对话可直接创建需求（source: "chat"）。调研已完成：机制为 `@deepseek-ai/dsh-tools` 的 defineTool + `inject: ["tools"]`。

## 风险与待确认

1. ~~StorageBackend 注入方式~~ **已确认（M1）**：`dsh --profile web` 默认加载 storage / storage-json（root=`~/.dsh/storages`）/ storage-domain（backend=json）三插件；`ctx.storageDomain` 声明合并注入，`Domain` 自带写链+内存读+事件，**无需自写 WriteChain**（octopus-users 的 WriteChain 是绕开 domain 层的旧写法）
2. 路由层请求体解析（读流 + JSON）
3. 壳内 mock 清理涉及 App.tsx，M4 单独评审
4. 插件加载失败隔离由 inject 机制保证