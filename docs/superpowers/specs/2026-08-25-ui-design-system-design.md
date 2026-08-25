# octopus UI 设计系统（octopus-ui）设计文档

- 日期：2026-08-25
- 状态：待批准
- 关联文档：`2026-08-25-octopus-workbench-design.md`（壳 + 功能插件架构）

## 目标

建立一套 UI 设计系统，保证 octopus 所有页面（含宿主壳页面与功能模块页面）**视觉精美、规范统一、可持续演进**：

1. **一致性由架构保证**，而非依赖个人自觉：颜色、间距、圆角、层级全部收敛到单一 token 源
2. **多品牌主题**：支持亮/暗 × 多套品牌色的正交组合，切换零成本
3. **交互质量下限**：Dialog/DropdownMenu/Toast 等"难交互"组件基于 Radix Primitives，可访问性（a11y）不因自研而降级
4. **低门槛产出**：页面开发者只会用到 `octopus/ui` 一个入口和有限的 utility class

### 已确认的决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 样式技术方案 | Tailwind CSS v4 | 团队选定；`@theme` 与 CSS 变量原生融合，token 即 utility |
| 主题能力 | 多品牌 × 亮暗 | 三段式 token 分层支撑 |
| 规范消费者 | 仅宿主团队 | 不做对第三方插件作者的正式契约与硬隔离，治理靠 lint + review |
| 整体架构 | 自建分层组件包（方案二） | 一致性由包结构与出口约束保证；个别组件实现可参考 shadcn 源码起步 |

## 非目标（v1）

- 不向第三方插件作者发布正式 UI 契约文档（包结构预留该能力，文档后补）
- 不引入 Storybook / 视觉回归测试（Chromatic 等）
- 不做多语言字体体系、不设计 logo/插画等品牌资产
- 不改动 dsh 宿主侧任何 UI

## 1. 总体架构

### 1.1 包结构

```
packages/
├── octopus/              # 宿主壳（已有）
├── octopus-quickstart/   # 示例功能模块（已有）
└── octopus-ui/           # ★ 新增：设计系统包
    ├── package.json      # peerDeps: react/react-dom；deps: @radix-ui/*（按需）、clsx
    └── src/
        ├── tokens.css        # Tailwind v4 @theme —— 所有 token 的唯一真源
        ├── primitives/       # 原语层（见 §3）
        │   ├── button/       #   每组件一目录：index.tsx + index.test.tsx
        │   ├── input/
        │   └── dialog/       #   Radix 封装件同样在此
        ├── layout/           # app-shell/ header/ sidebar/ page-container/
        ├── icons.tsx         # lucide-react 统一出口（见 §4.4）
        ├── cn.ts             # className 合并工具（clsx）
        └── index.ts          # ★ 唯一出口
```

### 1.2 三条铁律

1. **依赖单向**：`octopus → octopus-ui → (@radix-ui, lucide-react)`。octopus-ui 永远不反向依赖宿主或其他业务包。
2. **唯一出口**：所有页面只允许 `import { Button } from "octopus-ui"`（经 `index.ts`）。禁止直接 import `@radix-ui/*`、禁止从 `octopus-ui/dist/xxx` 深路径引用。
3. **组件三件套**：primitives/layout 下每个组件一个目录，必须带行为测试（vitest + testing-library）才能合入。

### 1.3 Tailwind 接入方式

- octopus-ui 构建产物为源码级 ES module（tsc 转译，样式类不编译），由消费方（octopus 的 web 构建）执行 Tailwind 扫描
- octopus 的主 CSS 入口仅两行职责：`@import "tailwindcss";` + `@import "octopus-ui/tokens.css";`
- `tokens.css` 内通过 `@source "../../packages/octopus-ui/src"` 保证子包类名被扫描

## 2. Token 规范

### 2.1 三段式颜色分层

```
第1层 色板层  --palette-*     原始色值集合（灰阶 12 级 + 各色相若干明度）
                              → 只允许 tokens.css 与组件内部引用，页面禁用
第2层 品牌层  --brand-*       每个品牌主题一组映射（primary 及其 hover/fg 等）
                              → 由 <html data-theme="…"> 切换
第3层 语义层  --color-*       业务唯一可见的变量（bg/surface/text/accent/danger…）
                              → 亮暗 × 品牌 = 该层取值的二维矩阵
```

`tokens.css` 骨架示例：

```css
/* 第1层：色板 */
:root {
  --palette-gray-50: oklch(98.5% 0.002 247);
  /* … */
  --palette-blue-500: oklch(62% 0.214 259);
}

/* 第3层：语义（亮色默认值，引用品牌层） */
:root {
  --brand-primary: var(--palette-blue-500);
  --color-bg: var(--palette-white);
  --color-surface: var(--palette-gray-100);
  --color-text: var(--palette-gray-950);
  --color-text-muted: var(--palette-gray-500);
  --color-accent: var(--brand-primary);
  --color-danger: var(--palette-red-500);
}

/* 亮暗维度 */
[data-mode="dark"] { /* 同一组语义变量的暗色取值 */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-mode="light"]) { /* 未手动指定时跟随系统 */ }
}

/* 品牌维度：新增一个品牌 = 新增一段 data-theme 覆盖 */
[data-theme="ocean"] {
  --brand-primary: var(--palette-teal-500);
}
```

Tailwind v4 注册（同在 `tokens.css`）：

```css
@theme inline {
  --color-background: var(--color-bg);
  --color-surface: var(--color-surface);
  --color-foreground: var(--color-text);
  --color-muted: var(--color-text-muted);
  --color-accent: var(--color-accent);
  --color-danger: var(--color-danger);
}
```

效果：页面写 `bg-background text-muted ring-accent`，换主题只改 `<html>` 的两个 attribute。

### 2.2 双维度主题协议

| 维度 | 载体 | 取值 |
|---|---|---|
| 亮暗 | `<html data-mode>` | `light` / `dark` / 缺省=跟随系统 |
| 品牌 | `<html data-theme>` | `default`（缺省）/ `ocean` / …后续扩展 |

octopus-ui 提供 `<ThemeProvider>`：管理这两个 attribute、持久化用户偏好（localStorage），并暴露 `useTheme()`。

### 2.3 非颜色 token

| 维度 | 规范 |
|---|---|
| 间距 | Tailwind 默认 4px 基数；常用 `p-4 gap-3 space-y-6` 级别，禁止魔法数 |
| 圆角 | 四档：`rounded-xs`(4px) / `rounded-sm`(8px) / `rounded-lg`(12px) / `rounded-full` |
| 阴影 | 两级 elevation：`shadow-elev-1`（卡片）/ `shadow-elev-2`(浮层)，暗色下降级为描边 |
| 字体 | system-ui 栈；字号走 Tailwind 默认阶（`text-sm/base/lg/xl/2xl`） |
| z-index | 五档常量：base(0) < dropdown(100) < sticky(200) < modal(300) < toast(400) |
| 动效 | 时长两档 `duration-fast(150ms)/duration-normal(250ms)`；缓动统一 `ease-[cubic-bezier(0.4,0,0.2,1)]` |

### 2.4 页面级红线

页面上**不允许出现**：具体色值（hex/oklch/rgb）、arbitrary color class（如 `bg-[#333]`）、裸 px/z-index 数值。发现即 review 打回；CI 以 grep 兜底（见 §5）。

## 3. 组件规范

### 3.1 分类原则

- **简单件直接写**：Button/Input/Card/Badge/Skeleton 等，原生标签 + Tailwind 类即可，不为包装而包装
- **难交互动件包 Radix**：涉及焦点管理、浮层定位、键盘导航、a11y 语义的一律以 Radix 为底（Dialog、AlertDialog、DropdownMenu、Popover、Tooltip、Toast、Select、Tabs、Switch、Checkbox、ScrollArea）
- 封装时**完整转发 props 与 ref**，不吞没 Radix 能力；a11y 行为不允许在封装中削弱

### 3.2 API 约定

```tsx
// variant × size 二维，默认值固定
type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger"  // 默认 secondary
  size?: "sm" | "md" | "lg"                                // 默认 md
}
```

- 所有组件遵循同一套 variant/size 词表，禁止组件私造同义词（如 `type=`、`tone=`）
- className 由调用方传入并与内部默认合并（`cn()`，v1 基于 clsx；出现真实覆盖冲突后再评估 tailwind-merge）
- 组件不自带 margin（外间距归布局层管），避免组合时对齐失控
- 受控/非受控双模式遵循 React 惯例（`value/onChange` + `defaultValue`）

### 3.3 首批组件清单（分期）

| 期 | 组件 |
|---|---|
| **P0 地基** | Button、Input、Card、Badge、Spinner、Skeleton、EmptyState、icons 出口、ThemeProvider |
| **P1 布局** | AppShell、Header、Sidebar、PageContainer |
| **P2 浮层与表单** | Dialog、AlertDialog、DropdownMenu、Tooltip、Toast、Select、Switch、Checkbox、Tabs、ScrollArea |
| **P3 增强** | Popover、Slider、Table、Avatar |

P0/P1 完成即可支撑现有欢迎页 + 设置页 + 模块页面的全面迁移；P2 按首个需要浮层的页面拉动。

### 3.4 新增组件流程

提案（一句话场景）→ 确认无既有组件可复用 → 归类（简单件/Radix 底座）→ 实现三件套 → 更新本清单 → 从 `index.ts` 导出。禁止在页面里"临时写个组件"而不入包。

## 4. 布局规范

### 4.1 页面骨架

```
<AppShell sidebar={<Sidebar items={…}/>} header={<Header title={…}/>}>
  <PageContainer>          ← 唯一的宽度/留白控制点（max-w + padding）
    …页面内容…
  </PageContainer>
</AppShell>
```

- AppShell 负责：栅格（侧栏 + 主区）、亮暗/品牌 attribute 挂载点、响应式折叠（`md:` 断点以下侧栏收起为抽屉，复用 Dialog）
- Header 只放标题 + 全局动作（主题切换等）；页面级动作放 PageContainer 内
- 页面自身**不写** max-width/padding/背景色——这些全部由 PageContainer/AppShell 提供

### 4.2 组装示例

```tsx
import { PageContainer, Card, Button } from "octopus-ui"

export default function SettingsPage() {
  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold">设置</h1>
      <Card className="mt-4 p-4">…表单区…</Card>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost">取消</Button>
        <Button>保存</Button>
      </div>
    </PageContainer>
  )
}
```

## 5. 守护与治理

### 5.1 自动化检查（CI 卡关）

1. **import 边界**：ESLint `no-restricted-imports` —— 业务包内禁止直接 import `@radix-ui/*`、`lucide-react`、`octopus-ui/src/**`
2. **裸值兜底**：CI 脚本 grep 业务包 `src/**/*.tsx`，命中 `#[0-9a-fA-F]{3,8}`、`bg-\[`、`text-\[`（arbitrary 色）即失败
3. 常规 `tsc --noEmit` + vitest 全绿

### 5.2 Review 清单（人工兜底）

- [ ] 颜色/间距/圆角是否全部来自语义 token 或预设档位
- [ ] 是否复用了 octopus-ui 既有组件，而非重复造轮子
- [ ] 浮层类需求是否走了封装组件（而不是手写 fixed 定位）
- [ ] 新组件是否完成三件套并入包

## 6. 迁移策略

现有代码渐进迁移，一步一验证：

1. **搭包**：新建 `packages/octopus-ui`，落地 tokens.css（将现 `--bg/--fg/--card/--accent` 映射到新语义名：`--color-bg/--color-text/--color-surface/--color-accent`，保证迁移期视觉零变化）+ Button/Card/Spinner + ThemeProvider
2. **壳页面接入**：octopus web 入口接入 Tailwind + tokens.css；App.tsx 改写为 AppShell + PageContainer 结构，ModuleGrid 改用 Card/Button；删除 styles.css 中被替代的部分（保留 vendor 相关配置不动）
3. **示范模块**：octopus-quickstart 同步改用 octopus-ui，作为"模块如何消费设计系统"的活文档
4. **收口**：开启 §5 的 lint 与 CI 检查，此后新代码按红线执行

## 7. 测试策略

- 组件：vitest + @testing-library/react，测**行为**（点击回调、受控切换、键盘操作走 Radix 自带能力不重复测）
- 主题：断言 `data-mode/data-theme` 切换后根元素 attribute 与持久化逻辑正确（CSS 变量实际取值属浏览器行为，不在 jsdom 断言范围）
- 壳页面：沿用现有 App.test.tsx / ModuleGrid.test.tsx 模式随迁移更新
- 视觉回归、浏览器截图对比：非目标（v1 不做）

## 8. 风险与开放问题

- **Tailwind 扫描跨包**：`@source` 指向 workspace 相对路径在不同机器/CI 下需验证（迁移任务 1 中最先验证）
- **vendor 共享**：若未来第三方模块也要用 react 之外的共享依赖（如 radix），需扩充 vendor.config.ts；v1 仅宿主团队使用，暂不动
- **clsx vs tailwind-merge**：v1 先 clsx，出现真实的类覆盖冲突案例后再引入 tailwind-merge，避免过早增重
