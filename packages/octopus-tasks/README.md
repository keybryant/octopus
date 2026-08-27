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
