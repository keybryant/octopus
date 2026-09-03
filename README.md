# octopus

DeepSeek Harness 个人专属工作台：壳插件 `octopus` + 一组功能插件（quickstart / projects / requirements / tasks / agent / users-view / auth 等）。

## 功能特性

| 能力 | 说明 | 提供插件 |
| --- | --- | --- |
| 🏠 工作台壳 | 模块注册契约（`register` / `list`）、`/workbench` 页面与 vendor 托管 | `octopus` |
| 🎨 设计系统 | 设计令牌、主题 Provider、基础组件与浮层（Radix UI + lucide-react） | `octopus-ui` |
| 👤 用户存储 | `octopus_users` 存储单元（users / sessions 表），storage-json 落盘 | `octopus-users` |
| 🔐 认证权限 | 登录 / 会话 / 角色，`single-user` 直通或 `multi-user` 管控 | `octopus-auth` |
| 👥 用户管理 | 管理员专用模块：禁用 / 降级普通用户 | `octopus-users-view` |
| 📁 项目管理 | 项目 CRUD + 自动创建 dsh 工作区 | `octopus-projects` |
| 📋 需求管理 | 需求 CRUD、状态流转（backlog → planned → in-progress → review → done） | `octopus-requirements` |
| ✅ 任务看板 | 需求拆解（AI 草稿 + 人工确认）、4 列看板拖拽迁卡 | `octopus-tasks` |
| 🤖 Agent 会话 | dsh AgentLoop 真实会话，未挂载时回退脚本 mock | `octopus-agent` |
| 🤖↔📋 Agent 编排 | 主 agent 工具（需求/任务 CRUD）+ 每任务独立子会话执行与跟踪 | octopus-workflow |

## 环境要求

| 依赖 | 要求 |
| --- | --- |
| Node.js | ≥ 20（推荐 22，`@types/node` 使用 ^22） |
| pnpm | 10.x（根 `package.json` 声明 `packageManager: pnpm@10.32.1`） |
| DeepSeek Harness | `dsh` CLI ≥ 0.1.1-rc.2（`devDependencies` 已声明） |

## 技术栈

- **运行时**：Node.js + [Cordis 4](https://github.com/cordiverse/cordis) 插件框架
- **前端**：React 18 + TypeScript 5.6 + Vite 6 + Tailwind CSS 4
- **UI 组件**：`octopus-ui` 设计系统（`@radix-ui/react-dialog` / `dropdown-menu`、`lucide-react` 图标、`clsx`）
- **测试**：Vitest 4 + Testing Library（React / DOM / user-event）+ jsdom
- **包管理**：pnpm workspace monorepo（`packages/*`）

## 快速开始

```sh
pnpm dev        # 一键：安装依赖 → 构建 → 挂载插件 → 启动 dsh web
pnpm dev:noopen # 同上但不打开浏览器
```

启动后访问 `http://127.0.0.1:3080/workbench`。

**说明**：`octopus-agent` 挂载后，工作台聊天即为真实 dsh agent 会话（需 `DEEPSEEK_API_KEY` 环境变量或 `$DSH_HOME/settings.yaml` 的 `llm-deepseek` 段）；未挂载时聊天自动回退脚本 mock。Agent 的审批/问题通道在聊天内以按钮/横幅呈现；会话权限沿用平台 `workspace-write`。

> **⚠️ 工具模式必设**：使用 DeepSeek 模型时（`llm-deepseek`），工作台会话必须开启 dsh 的 code-mode 工具流，否则模型输出的 DSML 工具调用（`<DSML工具:tool_calls>`）只会作为文本透传，**不会执行**（表现为“agent 只会聊天，不调工具/不加载 skill”）。在 profile 的 `cordis.patch.yml` 设置：
>
> ```yaml
> - id: tools
>   config:
>     mode: code       # 或 both
> ```
>
> 开启后即为 dsh 原生完整循环：DSML → `run_code`/注册工具真实执行 → 结果（含错误）回传模型 → 多轮迭代，skill/subagent/workflow 同标准预设一应俱全。

## 结构

- `packages/octopus`：工作台壳插件，提供 `ctx.workbench` 服务契约（`register` / `list`）与 `/workbench` 页面
- `packages/octopus-ui`：设计系统包（非插件）：设计令牌、主题 Provider、基础组件与浮层；同时由壳作为 vendor 托管，模块可直接 `import ... from "octopus-ui"`
- `packages/octopus-users`：用户存储服务插件：`octopus_users` 存储单元（users / sessions 表），storage-json 落盘
- `packages/octopus-auth`：权限体系插件：登录 / 会话 / 角色（`single-user` 直通或 `multi-user` 管控），提供 `/login` 与 `/api/octopus-auth/*`
- `packages/octopus-users-view`：「用户管理」模块插件（`access: "admin"`，仅管理员可见），可禁用 / 降级普通用户
- `packages/octopus-quickstart`：示例功能插件，验证模块注册与懒加载链路
- `packages/octopus-projects`：项目管理服务插件，持久化项目并暴露 `/api/octopus-projects` CRUD，自动创建 dsh 工作区
- `packages/octopus-requirements`：需求管理模块插件：需求 CRUD、状态流转（backlog → planned → in-progress → review → done）与 `octopus_requirements` 域持久化
- `packages/octopus-tasks`：任务管理模块插件：任务从需求拆解（AI 草稿 + 人工确认），4 列看板（todo → doing → review → done）拖拽迁卡，`octopus_tasks` 域持久化
- `packages/octopus-agent`：工作台 Agent 会话服务：dsh AgentLoop 真实会话 + `/api/octopus-agent`；未挂载时聊天回退脚本 mock
- `packages/octopus-workflow`：Agent 编排服务插件：主会话 14 个工具（需求/项目/任务/会话编排）+ 任务子会话（真实 AgentLoop、作用域工具、事件跟踪），依赖三域 store 服务

## 目录结构总览

```
octopus-monorepo/
├── packages/                  # pnpm workspace：全部插件包
│   ├── octopus/               # 工作台壳插件（模块注册 + vendor 托管 + /workbench 页面）
│   ├── octopus-ui/            # 设计系统纯库（非插件，不挂载）
│   ├── octopus-users/         # 用户存储服务插件
│   ├── octopus-auth/          # 登录 / 会话 / 角色权限插件
│   ├── octopus-users-view/    # 用户管理模块插件（仅管理员）
│   ├── octopus-quickstart/    # 示例模块插件（新插件模板）
│   ├── octopus-projects/      # 项目管理服务插件
│   ├── octopus-requirements/  # 需求管理模块插件
│   ├── octopus-tasks/         # 任务看板模块插件
│   ├── octopus-workflow/      # Agent 编排服务插件
│   └── octopus-agent/         # Agent 会话服务插件
├── designs/                   # 工作台 UI 设计稿（dev-workbench*.html）
├── docs/superpowers/          # 设计文档：plans（开发计划）+ specs（规格设计）
├── package.json               # 根脚本：dev / dev:noopen / build / test
├── pnpm-workspace.yaml        # workspace 配置
└── README.md
```

> 依赖方向：`octopus`（壳）→ `octopus-users` → `octopus-auth` → 各功能模块；`octopus-ui` 为公共库，所有模块均可 `import ... from "octopus-ui"`。

## 新增功能插件

1. 复制 `packages/octopus-quickstart` 目录结构（改包名/插件 id）
2. `src/index.ts` 中 `ctx.workbench.register({ id, title, order, entry, access })` 并自托管模块 bundle（`access` 可选：`"authenticated"`（缺省）或 `"admin"`，后者仅管理员可见，如 `octopus-users-view`）
3. 模块 bundle 构建须使用壳提供的 vendor 改写插件：在模块的 `web/vite.config.ts` 中 `import { octopusVendor } from "octopus/vite"` 并加入 plugins
4. 根 `package.json` 的 `dev`/`dev:noopen` 脚本追加 `./packages/<新包>`
5. `pnpm dev` 生效

模块契约：bundle 必须 default export 一个 React 组件；react 家族只能命名导入 `react`、`react-dom`、`react/jsx-runtime` 三者，另可导入 `octopus-ui`（由 `octopus/vite` 的改写插件统一映射到壳托管的 `/workbench/assets/vendor/*.js`，其余 react 子路径会构建报错）；托管与注册必须使用同一个 `/octopus/<id>/assets` 前缀。构建产物不入库（`.gitignore` 已忽略），发布时经 npm `files` 字段携带。

## 权限体系（octopus-auth）

权限由 `octopus-auth` 插件提供，运行模式由 profile 配置中的 `octopus-auth.mode` 决定：`single-user`（免登录直通）或 `multi-user`（登录 + 会话 + 角色）。

### 本机开发

- 将 `octopus-auth.mode` 设为 `single-user`：`/workbench` 免登录直通，行为等同旧版；
- 认证后端使用 storage-json（`octopus-auth.backend = "json"`，默认），需在配置中为后端指定 `root` 目录（用户表落盘目录）；
- 十个插件包全部安装（`pnpm dev` 已按依赖顺序挂载 octopus → octopus-users → octopus-auth → octopus-users-view → octopus-quickstart → octopus-projects → octopus-requirements → octopus-tasks → octopus-agent → octopus-workflow；`octopus-ui` 为纯库不挂载），行为差异只在运行模式。

### 公网部署（四强制项）

1. dsh 保持绑定 `127.0.0.1`，仅同机反向代理监听公网并终结 TLS；
2. 反向代理对**全部路径**套 forward-auth，且必须豁免三个路径：`/login`、`/api/octopus-auth/login`、`/api/octopus-auth/verify` —— 否则 subrequest 会自递归死循环（真实陷阱）；
3. 设置 `octopus-auth.secureCookie = true`（cookie 使用 `__Host-` 前缀）；
4. 反代绑定确切站点名，默认 server 直接拒绝（防 DNS Rebinding 配合作恶）。

Caddy 配置示例：

```caddy
workbench.example.com {
    @public path /login /api/octopus-auth/login /api/octopus-auth/verify
    handle @public {
        reverse_proxy 127.0.0.1:3080
    }
    handle {
        forward_auth 127.0.0.1:3080 {
            uri /api/octopus-auth/verify
        }
        reverse_proxy 127.0.0.1:3080
    }
}
```

> **<span style="color:red">警告：`single-user` 模式暴露公网 = 人人是管理员，任何访问者都能读写全部数据。该模式仅限本机开发，严禁部署到公网。</span>**

### 首次初始化

`multi-user` 模式下用户表为空时：在 profile 配置中写入 `octopus-auth.bootstrapAdmin = { username, password }` 后重启，首次启动自动创建管理员。未配置时访问 `/login` 只会看到「尚未配置初始管理员」提示（登录页不提供首个管理员创建表单）。

管理员拥有「用户管理」能力（禁用/降级普通用户）；普通用户仅见自己的工作台模块。`single-user` 模式下无登录概念，顶栏不显示登录/登出。

## Agent 工作流（octopus-workflow）

主 agent 会话（工作台聊天）可直接操作需求/任务/项目域，并为任务拉起独立子会话执行：

1. **创建需求**：聊天中让 agent 调用 `create_requirement`（项目 id 用 `list_projects` 查询）
2. **拆解任务**：agent 读取需求（`get_requirement`）后在对话内拆解，经 `create_tasks` 批量保存，并为每条任务指定执行的智能体（`agent` 字段，可选；用 `list_agent_roles` 查看可用角色）
3. **事件驱动派发**：PM agent 不直接启动子会话。将任务状态置为 doing（`update_task`）即触发 `octopus-tasks` 的任务状态变更事件，octopus-workflow 监听该事件为任务**新建**独立执行会话（工作目录=项目工作区；每次派发都新建会话，不复用旧会话）并驱动指定智能体开工；子 agent 完成后经 `report_task_status` 提交评审
4. **跟踪**：`task_session_status` 查询任务状态与最近事件摘要；`send_to_task_session` 追问；`stop_task_session` 停止并回退待处理

任务子会话为真实 dsh 会话，可在聊天面板会话列表打开观看；任务卡显示 agent 会话徽章与完成摘要。

> 子会话审批默认自动放行（`octopus-workflow.subSessionApproval: "allow"`）；需要审计时可设 `"never"`（所有需审批的工具调用将被确定性拒绝）。主会话审批仍走聊天内审批按钮。

## 测试与构建

```sh
pnpm test   # 全部单测
pnpm build  # 全部构建
```

## 设计文档（docs/superpowers）

### 规格设计（specs）

| 文档 | 主题 |
| --- | --- |
| `2026-08-25-octopus-workbench-design.md` | 工作台壳架构设计 |
| `2026-08-25-octopus-auth-design.md` | 认证与权限体系设计 |
| `2026-08-25-ui-design-system-design.md` | UI 设计系统（令牌 / 主题 / 组件） |
| `2026-08-26-octopus-projects-design.md` | 项目管理设计 |
| `2026-08-27-octopus-requirements-design.md` | 需求管理设计 |
| `2026-08-28-octopus-agent-design.md` | Agent 会话设计 |
| `2026-08-28-octopus-tasks-design.md` | 任务看板设计 |

### 开发计划（plans）

| 文档 | 主题 |
| --- | --- |
| `2026-08-25-octopus-workbench.md` | 工作台落地计划 |
| `2026-08-26-agent-homepage-v5.md` | Agent 首页 v5 计划 |
| `2026-08-26-octopus-auth.md` | 认证体系落地计划 |
| `2026-08-26-octopus-projects.md` | 项目管理落地计划 |
| `2026-08-28-octopus-agent.md` | Agent 会话落地计划 |
| `2026-08-28-octopus-tasks.md` | 任务看板落地计划 |

## 包级文档索引

| 包 | 独立 README |
| --- | --- |
| `octopus` | ✅ `packages/octopus/README.md` |
| `octopus-agent` | ✅ `packages/octopus-agent/README.md` |
| `octopus-projects` | ✅ `packages/octopus-projects/README.md` |
| `octopus-quickstart` | ✅ `packages/octopus-quickstart/README.md` |
| `octopus-requirements` | ✅ `packages/octopus-requirements/README.md` |
| `octopus-tasks` | ✅ `packages/octopus-tasks/README.md` |
| `octopus-workflow` | ✅ `packages/octopus-workflow/README.md` |
| `octopus-ui` / `octopus-users` / `octopus-auth` / `octopus-users-view` | ❌ 暂无（文档见根 README 与 `docs/superpowers`） |

## 常见问题（FAQ）

**Q1：agent 只会聊天，不调用工具 / 不加载 skill？**

工具模式未开启。在 profile 的 `cordis.patch.yml` 设置 `tools.config.mode: code`（或 `both`），详见上文「⚠️ 工具模式必设」。

**Q2：访问 /login 提示「尚未配置初始管理员」？**

`multi-user` 模式且用户表为空。在 profile 配置 `octopus-auth.bootstrapAdmin = { username, password }` 后重启，首次启动自动创建管理员。

**Q3：`single-user` 模式可以部署到公网吗？**

**严禁**。该模式人人即管理员，任何访问者都能读写全部数据，仅限本机开发；公网部署必须 `multi-user` + 反向代理 + forward-auth（详见「公网部署（四强制项）」）。

**Q4：模块 bundle 构建报错，提示 react 子路径无法解析？**

模块只能命名导入 `react`、`react-dom`、`react/jsx-runtime`，并统一通过 `octopus/vite` 的 vendor 改写插件映射到 `octopus-ui` 与壳托管的 vendor 资源，其余 react 子路径会构建报错。

**Q5：端口是多少？为什么访问不了？**

启动后访问 `http://127.0.0.1:3080/workbench`；请确认 `pnpm dev` 已完整执行（install → build → 插件挂载 → dsh web），且 3080 端口未被占用。

**Q6：构建产物会被提交进仓库吗？**

不会。`/packages/*/lib/`、`**/web/dist/`、`web-dist/` 等已在 `.gitignore` 中忽略；发布时经 npm `files` 字段携带。

## License

当前仓库**未包含 LICENSE 文件**，默认保留所有权利。如需对外发布或商用，请先与作者确认授权方式。

## 相关链接

- [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) —— 本工作台所基于的 DeepSeek 应用开发框架
- [Cordis](https://github.com/cordiverse/cordis) —— 插件框架运行时
