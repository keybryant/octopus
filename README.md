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
