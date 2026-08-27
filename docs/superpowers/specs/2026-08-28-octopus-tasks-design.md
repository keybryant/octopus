# octopus-tasks — 任务插件 设计文档

- 日期：2026-08-28
- 分支：feature-task（基于 dev 23cdefe）
- 状态：草案，待评审

## 背景与定位

octopus 为"壳 + 功能插件"架构。需求域已由 `octopus-requirements` 插件承接（domain + REST API + 前端模块）；任务域在壳内仍是纯 mock（`KanbanDrawer` + `KANBAN_TASKS` 硬编码，`TASK-28xx`，State 存 `useState`，刷新即失）。

本插件将任务域抽为独立功能插件 `octopus-tasks`：任务**只从需求拆解**（`requirementId` 必填），拆解方式为 **AI 生成草稿 + 人工确认**（AI 拆解先行 mock，服务端接口可替换）；任务看板（4 列）替换壳内 mock 看板；**AI 执行任务（agent）不在本次范围**，字段与代码默认值上预留接缝。

## 目标

1. 任务 CRUD + 状态流转（todo→doing→review→done 单向）+ 持久化（storage-domain，仿 requirements）
2. 从需求拆解：需求行内"拆解任务"入口 → AI 生成草稿（mock，可替换接口）→ 勾选/编辑 → 批量创建（全有或全无）
3. 任务看板抽屉（4 列）+ 拖拽迁卡（PATCH status）
4. 与现有插件协议一致：`ctx.workbench.register` + 自托管 assets + `ctx.webServer` 路由；per-project 隔离（projectId 强制）

## 非目标（v1）

- **不做 agent 执行**：任务无执行引擎、无 agent 会话；`assignee` 为自由文本预留，后继 agent 接入时再扩展（参见后续待办）
- 不做 kanban 列内排序（拖拽仅跨列迁态；列内按 id 升序）
- 不做多用户/权限、迭代/排期、任务与需求的级联状态联动
- 不做任务审批流/评论

## 数据模型

```ts
type TaskStatus = "todo" | "doing" | "review" | "done"
type Priority = "P0" | "P1" | "P2"          // 与 requirements 复用同一组取值

interface TaskRecord {
  id: string            // 服务端生成 "TASK-2800"
  title: string
  description: string   // 可为空串
  requirementId: string // 必填：任务只从需求拆解
  projectId: string     // 必填：继承自需求，强制项目隔离
  priority: Priority
  status: TaskStatus
  assignee: string | null // 自由文本；agent 接入后扩展为 agent/用户引用
  createdAt: string     // ISO
  updatedAt: string
}
```

状态机合法迁移：`todo → doing → review → done`；无回退；done 为终态；非法迁移返回 422 `invalid-transition`（与 requirements 的 `assertTransition` 模式一致）。

## 存储

参照 octopus-requirements `src/unit.ts`：

```ts
const TASKS_DOMAIN = defineDomain({
  name: "octopus_tasks", version: 1,
  tables: { tasks: domainTable(zodTaskSchema), meta: domainTable(metaSchema) },
})
```

- `src/unit.ts`：zod schema (zod ^4，同 requirements)
- `src/store.ts`：`TaskStore`，`ctx.storageDomain.open(TASKS_DOMAIN)`；读走内存，写走 domain 写链
- `meta.seq` 原子分配 id：默认起始 **2800**（与现有 mock 看板 `TASK-28xx` 样式对齐），`TASK-<seq>`
- **batch 创建原子性**：domain 层无多记录事务 API（仅单 key put/delete/update，写链串行）。方案：先全量校验入参（含任务数上限 50）→ `meta.update` 一次分配 N 个 id → 顺序 put；任一 put 失败则尽力删除已写入记录后抛出 500。校验后失败仅剩 IO 意外路径，语义为全有或全无

## API（webServer 路由）

前缀 `/api/octopus-tasks`，响应 `{ ok: true, data }` / `{ ok: false, error: { code, message } }`；body 解析复用 requirements 的 `readJsonBody`（256KiB 上限）。

| Method | Path | 说明 |
|---|---|---|
| GET | /api/octopus-tasks/tasks | 列表，`?projectId=` 必填；可选 `&status=` `&requirementId=` `&priority=` |
| POST | /api/octopus-tasks/tasks | 单条创建（手补任务留口，`requirementId`/`projectId` 必填） |
| POST | /api/octopus-tasks/tasks/batch | 批量创建，body `{ requirementId, projectId, tasks: [{title, description?, priority?, assignee?}] }`；全量校验通过才落库，全有或全无 |
| POST | /api/octopus-tasks/tasks/decompose | AI 拆解草稿：body `{ requirementId, title?, description?, priority? }`（客户端带需求内容），返回 `{ drafts: [{title, description, priority, assignee?}] }`；当前为服务端 mock 生成器，后续替换为真实 LLM 调用，**契约不变** |
| GET | /api/octopus-tasks/tasks/:id | 单条 |
| PATCH | /api/octopus-tasks/tasks/:id | 更新（title/description/priority/status/assignee；status 含状态机校验） |
| DELETE | /api/octopus-tasks/tasks/:id | 删除（幂等） |

要点（同 requirements 约定）：

- `projectId` 客户端提供（继承自需求记录；真实 agent 后端接入后可改为服务端按 requirementId 查需求域派生）
- POST 仅接受白名单字段，未知字段忽略；`status` 客户端创建时不可指定（固定 `todo`）
- 需求不存在时 batch/decompose 不做跨域校验（v1），500 级错误仅捕获 IO 异常

## 前端模块（web/）

vite.config.ts 照抄 requirements（react + tailwind + `octopusVendor()` + inlineCss，library mode → web/dist/index.js）。

- `web/src/types.ts` / `api.ts`：类型与 fetch 封装（`currentProjectId()` 读 `window.__octopusProjectId`，与 requirements 一致）
- **Board4.tsx**：4 列看板（待处理/进行中/评审中/已完成，列头同 mock 样式：dot + label + count）；卡片 = id + priority badge + title + assignee 头像；**拖拽用原生 HTML5 DnD**（dragstart/dragover/drop，跨列 PATCH status，乐观更新 + 失败回滚 + 提示）；v1 不引入 dnd-kit 依赖，后续体验升级再换
- **DecomposeModal.tsx**：拆解弹窗。挂载时若载荷存在自动请求 `decompose`（loading 态）→ 草稿行列表（title 可编辑、priority 下拉、assignee 输入、每行勾选，默认全选）→ "创建任务"按钮 → `tasks/batch` → 成功后刷新看板并关闭；草稿为空时展示手动行编辑（至少一行兜底）
- 模块入口 `index.tsx`（default export）：读取载荷 → 渲染看板；任务看板入口（无载荷）仅显示看板 + 空态提示"从需求列表行内『拆解任务』入口拆分新任务"（v1 任务模块不内建需求选择器，避免跨插件数据耦合）

### 跨插件桥接（拆解链路）

需求插件（octopus-requirements）表格行操作新增"拆解任务"按钮；需求域在内存中持有该行记录，可携带 `{requirementId, title, description, priority}`：

1. 需求插件 `dispatchEvent` 到 `window`，事件名常量由 **octopus-ui 导出**（`OCTOPUS_DECOMPOSE_EVENT = "octopus:decompose-request"`，兼作模块间契约层；壳与两插件均依赖 octopus-ui 且 vendor 单实例）
2. 壳 `App.tsx` 监听该事件，写 `window.__octopusDecomposePayload`（`{requirementId, title, description?, priority?}`），打开 `drawer = "tasks"`
3. `TasksDrawer.tsx`（壳新组件，仿 `RequirementsDrawer`）动态加载 tasks 模块；模块挂载时读取并**清空**载荷（消费一次），`requirementId` 传给 DecomposeModal 自动发起拆解

任务看板抽屉同时保留"任务看板"按钮入口（ProjectStrip 已有），展示当前项目全部任务；两按钮互斥共存。

## 壳改动与 mock 清理

- `App.tsx`：`KanbanDrawer` 替换为 `TasksDrawer`（动态加载 `modules.find(m => m.id === "tasks")` 的 entry）；删除 `columns` state 与 `handleCreateTask`；监听 decompose 事件
- 删除 `components/KanbanDrawer.tsx`、`NewTaskModal.tsx` 及 `lib/datasource.ts` 的 `KANBAN_COLUMNS`/`KANBAN_TASKS`/`KANBAN_REVIEW`/`KANBAN_DONE`、`lib/types.ts` 的 `KanbanTask`/`KanbanColumn`/`NewTaskInput`
- **保留**：`PRIORITY_CARDS`/`INITIAL_ARTIFACTS`/`QUICK_PROMPTS`/`createDefaultAgentClient`（聊天 mock 域，非任务域）
- 壳内既有组件测试同步更新（移除 KanbanDrawer 相关断言）

## 包结构

```
packages/octopus-tasks/
├── package.json            # peer: cordis, octopus；dep: dsh-storage(-domain)；dsh.bundle.patch
├── cordis.patch.yml        # insert { id: octopus-tasks, name: octopus-tasks }
├── tsconfig.json / tsconfig.build.json / vitest.config.ts
├── src/
│   ├── index.ts            # apply: inject [workbench, webServer, storageDomain]；模块+路由+assets+effect 清理
│   ├── types.ts            # TaskRecord/TaskStatus/TaskInput/TaskPatch + 错误码 + 状态机
│   ├── unit.ts             # defineDomain octopus_tasks
│   ├── store.ts            # TaskStore（CRUD/batch/decompose mock 生成器）
│   └── *.test.ts
└── web/
    ├── vite.config.ts / tsconfig.json
    └── src/{index.tsx, api.ts, types.ts, Board4.tsx, DecomposeModal.tsx}
```

构建与挂载：参照 requirements（`tsc -p tsconfig.build.json && vite build web ... && tsc -p web/tsconfig.json`；根 package.json dev 脚本追加包；pnpm-workspace.yaml 已 glob）。

## 测试

- Host：`store.test.ts`（CRUD、状态机非法迁移、seq 原子、batch 全有或全无——含校验失败零写入与写失败回滚、decompose mock 契约）、`routes.test.ts`（mock webServer，同 requirements）
- Web：`Board4` 拖拽 PATCH（组件测试）、`DecomposeModal` 载荷消费/草稿编辑/批量创建（api mock）、`api.test.ts`
- 壳：App/ProjectStrip 回归测试更新
- 手动验收：`pnpm dev` → "任务看板"出现 4 列 → 需求行"拆解任务" → 草稿确认 → 看板出现任务 → 拖拽迁卡 → 重启 dsh 数据仍在

## 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | 包骨架 + 存储单元 + TaskStore（CRUD/状态机/batch/decompose mock）+ 单测 | pnpm test 全绿 |
| M2 | REST API（list/get/create/batch/decompose/patch/delete）+ 路由单测 | curl 可完成拆解与 CRUD |
| M3 | 前端看板 + 拖拽 + DecomposeModal + 模块注册 | 浏览器端到端：拆解→看板→拖拽→刷新不丢 |
| M4 | 需求插件行内拆解入口（事件）+ 壳 TasksDrawer 接线 + 清理壳任务 mock | 壳内无任务 mock，全链路可走通 |
| M5 | README、files 打包、合并 dev 检查 | 可发布形态 |

## 后续待办（推迟项）

- **agent 执行任务**：两种路径（推荐先工具注册）——(a) tasks 插件注册 DSH 工具 `list_tasks/claim_task/update_task`（`ctx.tools.register(defineTool)`，参照 dsh-tools 模式），agent 会话内接管任务、报告进度；(b) 卡片"Agent 执行"按钮起 headless 会话在项目 workspace 内实际改码（需 session/git/安全隔离，工作量大）
- 真实 LLM 拆解：替换 `decompose` 处理器内部实现（契约不变）
- 需求自动拆解：需求创建后可选自动生成任务草稿（source: chat 同源机制）
- 看板列内排序（dnd-kit）、任务 ↔ 需求状态联动（requirement `in-progress` 由子任务自动推导等）

## 风险与待确认

1. batch 原子性为"校验全绿 + 写入失败尽力回滚"，非事务；storage-json 本地串行写下概率极低（M1 验证）
2. decompose 草稿生成的规则质量：mock 阶段标题模式既定（如"实现 X"/"验证 X"），真实 LLM 接入时由后端保证契约
3. 事件桥接依赖 osctopus-ui 导出的常量（两插件 + 壳同一 vendor 实例，常量在各自 bundle 内联，值一致即可）
4. 原生 HTML5 DnD 兼容性：桌面浏览器 OK，移动端无拖拽 → v1 兜底为卡片内状态下拉（同编辑弹窗状态切换），避免无路径
