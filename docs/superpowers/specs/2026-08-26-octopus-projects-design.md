# octopus-projects 项目管理服务插件 设计文档

- 日期：2026-08-26
- 状态：已批准（方向：只做服务端插件；壳内新增项目设置弹窗；数据模型五字段）
- 关联文档：`2026-08-25-octopus-workbench-design.md`（壳架构）、`2026-08-25-ui-design-system-design.md`（UI 规范）、`2026-08-26-agent-homepage-v5.md`（v5 首页）

## 背景

v5 改版后工作台首页已是 agent 聊天形态，项目管理 UI（项目切换器、新建项目弹窗、看板/需求抽屉）已长在壳里，但数据全部是前端 mock 内存态（`lib/datasource.ts` + `useState`），刷新即丢。v5 计划明确「接口形状按未来 API 预留」。本文档定义把项目域落到真实持久化的方案：**新建 `octopus-projects` 服务端插件负责存储与 API，壳前端小步接入**。

## 决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| 插件拆分 | 只做服务端插件，UI 留在壳内 | v5 后 PM UI 已在壳中，独立 UI 插件会重复冲突 |
| 通信方式 | HTTP API 松耦合（方案 A） | 即插即拆、与 dsh apiProxy 风格一致 |
| 持久化 | dsh 官方 `storageDomain`（JSON 文件域） | 官方实现，原子写、zod 校验、人类可读落盘 |
| 工作区绑定 | 创建时自动建 dsh 工作区 | 每个项目对应一个 agent 工作区 |
| 字段 | name/description/status/workspacePath/createdAt 五字段 | 用户指定；项目类型暂不做 |
| 目录来源 | `defaultWorkspaceRoot + name` 自动拼接 | 用户指定；名称兼作目录名故不可改 |

## 数据模型

```ts
// src/domain.ts
export const PROJECT_STATUS = ["active", "paused", "done", "archived"] as const
export type ProjectStatus = (typeof PROJECT_STATUS)[number]   // 进行中/已暂停/已完成/已归档

export const projectRecord = z.object({
  name:          z.string().min(1),   // 项目名称，兼作目录名，创建后不可变
  description:   z.string(),          // 项目介绍
  status:        z.enum(PROJECT_STATUS),
  workspacePath: z.string(),          // = join(defaultWorkspaceRoot, name)，创建时定格
  workspaceId:   z.string(),          // dsh workspaceRegistry 稳定 id（内部关联键）
  createdAt:     z.string(),          // ISO-8601
})

export const projectsDomainSpec = defineDomain({
  name: "projects",                    // 匹配 /^[a-z][a-z0-9_]*$/
  version: 1,
  tables: { projects: domainTable(projectRecord) },   // 主键 projectId = randomUUID()
})
```

经官方 JSON 后端落盘为 `<宿主存储根>/projects.json`（unit 名即 domain 名，具体路径由宿主存储装配配置决定），写入走临时文件 + fsync + 原子 rename。

### 名称校验（name 兼作目录名）

- 去首尾空白后长度 1–64
- 拒绝 Windows 非法字符：`\ / : * ? " < > |` 与控制字符（正则 `^[^\\/:*?"<>|\x00-\x1f]+$`）
- 拒绝 `.` 与 `..`

## 配置

```ts
export const Config = z.object({
  defaultWorkspaceRoot: z.string().default("~/octopus-projects"),
})
```

启动时把 `~` 展开为 `os.homedir()` 得到绝对根目录；`GET /api/octopus-projects/config` 返回展开后的绝对路径供表单展示。

## 包结构

```
packages/octopus-projects/
├── package.json        # type: module；main lib/index.js；dsh.bundle.patch
├── cordis.patch.yml    # insert { id: octopus-projects, name: octopus-projects }
├── src/
│   ├── index.ts        # apply(ctx, config)：open domain → 注册路由（effect 管理 disposer）
│   ├── domain.ts       # defineDomain + projectRecord + Config
│   ├── api.ts          # 单一 prefix 路由内部分发（method + pathname）
│   └── *.test.ts       # vitest 单测
├── tsconfig.build.json
└── vitest.config.ts
```

- `inject = ["webServer", "storageDomain", "workspaceRegistry"]`；任一缺失则插件加载失败（cordis 隔离，不影响其他插件）
- `@deepseek-ai/dsh-storage-domain`、`@deepseek-ai/dsh-workspace` 以 devDependencies 引入仅取类型与 `defineDomain`/`domainTable` 助手，运行时服务由宿主装配注入
- peerDependencies：`@deepseek-ai/cordis`、`octopus`（复用 `WebServerLike` 类型）

## Host 端行为

`apply(ctx, config)`：

1. `await ctx.storageDomain.open(projectsDomainSpec)` 取得 domain，挂 `table("projects")`；open 失败则注册一个恒返 503 的占位路由并跳过其余逻辑（失败隔离）
2. 注册单一前缀路由 `{ kind: "prefix", path: "/api/octopus-projects" }`，handler 内按 method + pathname 分发；请求体从真实 Node `IncomingMessage` 流读取并 `JSON.parse`
3. 全部生命周期经 `ctx.effect()` 管理 disposer

## API 契约

前缀 `/api/octopus-projects`，响应均为 `application/json`：

| 方法 + 路径 | 请求体 | 成功响应 | 说明 |
|---|---|---|---|
| `GET /config` | – | `{ defaultWorkspaceRoot }` | 展开后的绝对路径 |
| `GET /projects` | – | `{ items: ProjectView[] }` | 按 createdAt 倒序 |
| `POST /projects` | `{ name, description?, status? }` | `{ project }` | 见下方创建流程 |
| `PATCH /projects/:id` | `{ description?, status? }` | `{ project }` | 仅这两个字段可改 |
| `DELETE /projects/:id` | – | `{ deleted: true }` | 只删记录，不动目录/工作区 |

`ProjectView` 即 projectRecord 全字段（含 id）。

### 创建流程（POST）

1. 校验请求体 schema 与名称合法性 → 不合法 400
2. `workspacePath = join(root, name)`；`fs.stat` 已存在 → 409 `workspace-path-conflict`
3. `fs.mkdir(workspacePath, { recursive: true })`
4. `ctx.workspaceRegistry.create(workspacePath, name)` → 得到稳定 `workspaceId`；registry 抛错映射 409
5. `randomUUID()` 生成 projectId，`table.put(id, { ...record, createdAt: now })`
6. 返回 `{ project }`

### 错误约定

| 状态码 | 场景 |
|---|---|
| 400 | JSON 解析失败 / schema 校验失败 / 名称非法 |
| 404 | 未知 projectId 或未知子路径 |
| 405 | 非 CRUD 允许的 method |
| 409 | 目录已存在 / workspaceRegistry 创建失败 |
| 500 | 未捕获异常（JSON 错误信息） |
| 503 | 存储域未就绪 |

## 壳改造：项目设置弹窗（packages/octopus/web）

### 入口

`TopBar` 右上角设置菜单中现存的死链菜单项「项目设置」（TopBar.tsx:92）激活为触发器：TopBar 新增 prop `onOpenProjectSettings: () => void`，App 打开弹窗。

### ProjectSettingsModal 组件（components/ProjectSettingsModal.tsx）

复用 octopus-ui 的 `Modal`（模式同 NewProjectModal），props：`{ open, onClose, project, onSave, onDelete }`。

| 字段 | 控件 |
|---|---|
| 项目名称 | 只读文本 |
| 工作区目录 | 只读 mono 文本 |
| 创建时间 | 只读文本（本地化格式） |
| 项目介绍 | Textarea 可编辑 |
| 项目状态 | 四态 segmented 单选（active/paused/done/archived ↔ 中文标签） |

底部按钮：保存（primary）/ 删除项目（danger 文字钮）/ 取消。

- 保存：`onSave({ description, status })` → App 发 PATCH → 更新本地 state（切换器、指标条同步）；失败弹窗内提示且不关闭
- 删除：先二次确认（确认文案「删除后不可恢复，工作区目录与会话将保留」）→ `onDelete()` → App 发 DELETE → 移出本地 state 并切换到列表第一个项目；删除确认态在弹窗内实现（非浏览器 confirm）

### 数据接入（App.tsx）

- 挂载时 `GET /api/octopus-projects/projects` 初始化 projects state；请求失败回退现有 mock 数据源并在控制台告警（保住离线演示）
- `handleCreateProject` 改走 POST（表单维持 name/description，status 缺省 active）；成功后追加并选中
- 需求池/任务看板仍走 mock（本设计范围外）

## 根工程

- `package.json` 的 `dev`/`dev:noopen` 脚本追加 `./packages/octopus-projects`

## 测试

**插件单测（vitest）：**
- domain：schema 校验（status 枚举拒绝非法值）、名称校验函数（非法字符/`.`/`..`/超长）
- api 分发（mock webServer/storageDomain/workspaceRegistry + 内存 table）：
  - POST happy path：mkdir → create → put → 201 返回记录；workspacePath 拼接正确
  - POST 目录已存在 → 409；名称非法 → 400；registry 抛错 → 409
  - GET 列表按 createdAt 倒序；GET config 返回展开路径
  - PATCH 仅更新给定字段；未知 id → 404
  - DELETE 移除记录；再次 GET 不含该 id
  - 非 GET/HEAD/POST/PATCH/DELETE → 405；坏 JSON → 400

**壳单测：**
- ProjectSettingsModal：渲染只读字段、编辑介绍/切状态后 onSave 携带新值、删除需二次确认后才回调、取消不回调
- TopBar：点击「项目设置」菜单项触发 `onOpenProjectSettings`
- App 集成：打开弹窗 → 保存后切换器文本更新；删除后回落第一个项目

**手工联调：**
`pnpm dev:noopen` → 新建项目 → 检查 `~/octopus-projects/<名称>` 目录已建、dsh 主界面工作区列表出现该项目 → 改状态/介绍 → 刷新页面数据仍在 → 删除项目 → 目录保留。

## 非目标

- 需求池/任务看板的持久化（后续迭代）
- 项目名称修改、成员/迭代/进度等扩展字段
- 项目详情独立页面
- 多用户/权限

## 后续迭代

- 需求与任务迁入同一 domain（tables: requirements/tasks）
- 打开工作区动作（待 dsh 主界面提供深链路由后补）
