# octopus-requirements

octopus 工作台的功能插件：**需求管理**。提供需求 CRUD、状态流转与本地持久化，注册为 /workbench 的"需求管理"模块卡片。

## 功能

- 需求列表：编号 / 标题 / 描述 / 优先级（P0-P2）/ 状态 / 负责人 / 创建时间
- 新建 / 编辑需求（标题必填，描述、优先级、负责人可选；同一弹窗复用）
- 状态流转（DropdownMenu）：backlog → planned → in-progress → review → done，done 为终态
- 按状态筛选、删除（带确认）
- 数据持久化：基于 dsh 的 storage 域（ctx.storageDomain，json 后端，~/.dsh/storages/octopus_requirements.json）

## 架构

```
src/
├── index.ts        # 插件入口：打开需求域 + 注册模块/API/静态托管
├── types.ts        # 领域模型（RequirementRecord/状态机/错误码）
├── unit.ts         # storage 域定义（defineDomain + zod schema）
├── store.ts        # RequirementStore：CRUD + 原子 id 生成 + 状态校验
├── routes.ts       # REST API 路由（/api/octopus-requirements）
└── *.test.ts       # host 单测（真实 storage 链路）
web/
└── src/            # 模块 bundle：React 组件（octopus-ui + tailwind），CSS 内联
```

## API

统一响应 { ok: true, data } / { ok: false, error: { code, message } }：

| Method | Path | 说明 |
|---|---|---|
| GET | /api/octopus-requirements/requirements | 列表（可选 ?status=&priority=） |
| POST | /api/octopus-requirements/requirements | 创建（title 必填） |
| GET | /api/octopus-requirements/requirements/:id | 单条 |
| PATCH | /api/octopus-requirements/requirements/:id | 更新（含状态机校验，非法迁移 422） |
| DELETE | /api/octopus-requirements/requirements/:id | 删除（幂等） |

错误码：not-found(404)、invalid-input(400)、invalid-transition(422)、invalid-json(400)、bad-request(400)、payload-too-large(413，请求体超 256KiB)、method-not-allowed(405)。

注意：POST 的 source 字段由服务端固定为 manual（预留 chat 工具使用），客户端传入会被忽略。

## 开发

```sh
pnpm --dir packages/octopus-requirements test   # 单测（store + routes + web）
pnpm --dir packages/octopus-requirements build  # tsc + vite（web/dist）
```

## 挂载

根目录 pnpm dev 已包含本插件（./packages/octopus-requirements）；也可手动：

```sh
pnpm dsh plugin --profile web add ./packages/octopus ./packages/octopus-quickstart ./packages/octopus-requirements
```

启动后访问 http://127.0.0.1:3080/workbench，展开"需求管理"卡片。
