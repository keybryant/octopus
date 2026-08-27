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
3. 模块 bundle 构建须使用壳提供的 vendor 改写插件：在模块的 `web/vite.config.ts` 中 `import { octopusVendor } from "octopus/vite"` 并加入 plugins
4. 根 `package.json` 的 `dev`/`dev:noopen` 脚本追加 `./packages/<新包>`
5. `pnpm dev` 生效

模块契约：bundle 必须 default export 一个 React 组件；react 家族只能命名导入 `react`、`react-dom`、`react/jsx-runtime` 三者（由 `octopus/vite` 的改写插件映射到壳托管的 `/workbench/assets/vendor/*.js`，其余 react 子路径会构建报错）；托管与注册必须使用同一个 `/octopus/<id>/assets` 前缀。构建产物不入库（`.gitignore` 已忽略），发布时经 npm `files` 字段携带。

## 权限体系（octopus-auth）

权限由 `octopus-auth` 插件提供，运行模式由 profile 配置中的 `octopus-auth.mode` 决定：`single-user`（免登录直通）或 `multi-user`（登录 + 会话 + 角色）。

### 本机开发

- 将 `octopus-auth.mode` 设为 `single-user`：`/workbench` 免登录直通，行为等同旧版；
- 认证后端使用 storage-json（`octopus-auth.backend = "json"`，默认），需在配置中为后端指定 `root` 目录（用户表落盘目录）；
- 五个包全部安装（`pnpm dev` 已按依赖顺序挂载 octopus → octopus-users → octopus-auth → octopus-users-view → octopus-quickstart），行为差异只在运行模式。

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

`multi-user` 模式下用户表为空时，二选一：

- 在 profile 配置中写入 `octopus-auth.bootstrapAdmin = { username, password }` 后重启，首次启动自动创建管理员；
- 或直接访问 `/login`，按页面提示完成首个管理员账号创建。

管理员拥有「用户管理」能力（禁用/降级普通用户）；普通用户仅见自己的工作台模块。`single-user` 模式下无登录概念，顶栏不显示登录/登出。

## 测试与构建

```sh
pnpm test   # 全部单测
pnpm build  # 全部构建
```
