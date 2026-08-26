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
- `packages/octopus-projects`：项目管理服务插件，持久化项目并暴露 `/api/octopus-projects` CRUD，自动创建 dsh 工作区

## 新增功能插件

1. 复制 `packages/octopus-quickstart` 目录结构（改包名/插件 id）
2. `src/index.ts` 中 `ctx.workbench.register({ id, title, order, entry })` 并自托管模块 bundle
3. 模块 bundle 构建须使用壳提供的 vendor 改写插件：在模块的 `web/vite.config.ts` 中 `import { octopusVendor } from "octopus/vite"` 并加入 plugins
4. 根 `package.json` 的 `dev`/`dev:noopen` 脚本追加 `./packages/<新包>`
5. `pnpm dev` 生效

模块契约：bundle 必须 default export 一个 React 组件；react 家族只能命名导入 `react`、`react-dom`、`react/jsx-runtime` 三者（由 `octopus/vite` 的改写插件映射到壳托管的 `/workbench/assets/vendor/*.js`，其余 react 子路径会构建报错）；托管与注册必须使用同一个 `/octopus/<id>/assets` 前缀。构建产物不入库（`.gitignore` 已忽略），发布时经 npm `files` 字段携带。

## 测试与构建

```sh
pnpm test   # 全部单测
pnpm build  # 全部构建
```
