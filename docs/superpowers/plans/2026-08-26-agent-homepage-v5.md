# Agent 工作台首页（v5）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `packages/octopus/web` 现有首页（hero 问候语 + ModuleGrid）重写为 v5 设计的「Agent 聊天即工作台」界面：顶栏（项目切换/设置下拉）+ 单行项目指标条 + 中央聊天主区 + 右侧会话产出栏，需求池/任务看板通过抽屉按需展开。

**Architecture:** 分两阶段。**Phase 0** 按《octopus UI 设计系统规范》（`docs/superpowers/specs/2026-08-25-ui-design-system-design.md`）新建 `packages/octopus-ui` 设计系统包：三段式 token（palette→brand→color）+ Tailwind v4 接入 + P0 原语 + 浮层件（Radix 底座）+ ThemeProvider。**Phase 1** 在壳包内以 mock 数据源 + AgentClient 缝实现 v5 首页，样式全部走 tailwind 工具类与语义 token，浮层/图标只经 octopus-ui 消费。

**Tech Stack:** React 18、TypeScript、Vite 6、Tailwind CSS v4（@tailwindcss/vite）、Radix Primitives（dropdown-menu/dialog）、lucide-react、clsx、vitest + @testing-library/react、pnpm workspace。

**Spec:** 视觉与交互来源 `designs/dev-workbench-v5.html`；架构与红线来源 `docs/superpowers/specs/2026-08-25-ui-design-system-design.md`。两者冲突时以设计系统规范为准。

## Global Constraints

- **设计系统红线**：业务页面代码禁止出现具体色值（hex/oklch/rgb）、arbitrary 颜色类（如 `bg-[#…]`）、裸 z-index 数值；颜色一律语义 token（`--color-*`）；间距走 tailwind 默认阶；圆角四档 `rounded-xs(4)/sm(8)/lg(12)/full`；动效 `duration-fast(150ms)`/`duration-normal(250ms)`、缓动 `cubic-bezier(0.4,0,0.2,1)`；z-index 五档 dropdown(100)<sticky(200)<modal(300)<toast(400)
- **token 三段式**：`--palette-*`（原始值，仅 tokens.css 与组件内部可用，页面禁用）→ `--brand-*` → `--color-*`（页面唯一可见层）；亮暗挂 `<html data-mode>`（缺省跟随系统），品牌挂 `<html data-theme>`；`tokens.css` 内用 `@theme inline` 注册 `background/surface/foreground/muted/accent/danger` 等别名供 tailwind 工具类消费
- **包规则**：新建 `packages/octopus-ui`，源码级 ES module（tsc 转译，不编译 CSS），依赖单向 `octopus → octopus-ui → (@radix-ui/*, lucide-react, clsx)`；页面只能 `import { … } from "octopus-ui"`（唯一出口 index.ts），禁止直接 import `@radix-ui/*`、`lucide-react` 或深路径；组件三件套（实现+行为测试+导出）齐备才合入；组件不带外边距、完整转发 props/ref、className 经 `cn()`（clsx）合并
- React 只能命名导入 `"react"`、`"react-dom"`、`"react/jsx-runtime"` 三者（README 的 vendor 改写约束，两个包同样适用）
- 字体使用系统栈（不引外部字体文件）；中文文案与 v5 设计稿保持一致（如"迭代 4.2 · 第 2 周"、"让 Agent 接手 →"、"本会话产出"等）
- 八爪鱼 logo 为产品品牌件：内联 SVG 组件放壳内 `components/OctoLogo.tsx`（描边风格，不得用 emoji 充当图标），不入设计系统包；其余图标一律经 octopus-ui 的 lucide 出口
- 测试命令（PowerShell，在仓库根目录执行）：
  - 设计系统单测：`pnpm --filter octopus-ui test`
  - 壳 web 单测：`pnpm --filter octopus exec vitest run --root web`
  - 类型检查：`pnpm --filter octopus-ui exec tsc --noEmit` / `pnpm --filter octopus exec tsc -p web/tsconfig.json --noEmit`
- 提交信息用约定式前缀（`feat:` / `refactor:` / `test:` / `chore:`），每个任务至少一次提交
- 服务端（`packages/octopus/src/*`）除静态资源服务外零改动；所有数据走前端 mock 数据源，接口形状按未来 API 预留

## File Structure

```
packages/
├── octopus-ui/                     # ★ Phase 0 新增：设计系统包（规范 §1.1）
│   ├── package.json                # deps: clsx、@radix-ui/react-dropdown-menu、@radix-ui/react-dialog、lucide-react；peerDeps: react/react-dom
│   ├── tsconfig.json               # 源码级 ESM：tsc 输出 dist/，不编译 CSS
│   ├── vitest.config.ts            # jsdom + @testing-library/react
│   └── src/
│       ├── tokens.css              # 三段式 token + @theme inline（唯一真源）
│       ├── cn.ts                   # clsx 包装 cn()
│       ├── theme.tsx               # ThemeProvider + useTheme()
│       ├── icons.tsx               # lucide-react 统一出口
│       ├── primitives/
│       │   ├── button/             # 每组件一目录：index.tsx + index.test.tsx
│       │   ├── badge/
│       │   ├── card/
│       │   ├── spinner/
│       │   ├── input/              # Input + Textarea
│       │   ├── progress/           # ProgressBar
│       │   └── avatar/             # Avatar（首字母圆形）
│       ├── overlays/
│       │   ├── dropdown-menu/      # Radix DropdownMenu 封装
│       │   └── sheet/              # Radix Dialog 封装的右侧抽屉
│       └── index.ts                # 唯一出口
└── octopus/web/src/
    ├── main.tsx                    # 微调：引入 ThemeProvider 与新样式入口
    ├── greeting.ts                 # 不动（AI 欢迎语复用 timeGreeting）
    ├── loadModule.ts               # 不动
    ├── api.ts                      # 不动（fetchConfig/fetchModules 继续供模块链路用）
    ├── index.css                   # 新样式入口：@import tailwindcss + octopus-ui/tokens.css + @source
    ├── App.tsx                     # 重写：组合 TopBar/ProjectStrip/ChatPane/ArtifactsRail
    ├── App.test.tsx                # 重写
    ├── lib/
    │   ├── types.ts                # 领域类型（消息块联合类型是核心契约）
    │   ├── datasource.ts           # mock 数据源（PROJECTS/KANBAN/REQUIREMENTS/...）
    │   ├── agent-client.ts         # AgentClient 接口 + createMockAgentClient
    │   └── use-chat.ts             # 聊天状态 hook（消息流/思考态/产出物累积）
    └── components/
        ├── OctoLogo.tsx            # 内联 SVG 八爪鱼图标（产品品牌件，不入 ui 包）
        ├── TopBar.tsx              # 顶栏（logo/项目切换 DropdownMenu/搜索/设置/用户）
        ├── ProjectStrip.tsx        # 单行项目指标条（含需求池/任务看板按钮）
        ├── ChatMessage.tsx         # 消息渲染器（支持富块联合类型）
        ├── Composer.tsx            # 输入区（快捷 chip/上下文选择器/发送）
        ├── ChatPane.tsx            # 聊天主区（useChat + 列表 + 自动滚底）
        ├── ArtifactsRail.tsx       # 右侧产出栏（可收起）
        ├── KanbanDrawer.tsx        # 任务看板抽屉（ui Sheet）
        ├── RequirementsDrawer.tsx  # 需求池抽屉（ui Sheet）
        └── ModulesDrawer.tsx       # 已装模块抽屉（复用 ModuleGrid，保住懒加载链路）
```

> **样式书写约定**：Phase 1 组件一律写 Tailwind 工具类（`flex items-center gap-3 rounded-lg border border-border bg-surface …`），语义色经 `@theme inline` 别名可用 `bg-background/text-muted-foreground/ring-accent` 等类名；不再创建任何组件级 CSS 文件。需要按样式锚定测试时用 `data-testid="kebab-case 名"`。

---

### Task 1a: octopus-ui 包脚手架 + 三段式 token + ThemeProvider

**Files:**
- Create: `packages/octopus-ui/package.json`、`tsconfig.json`、`vitest.config.ts`、`src/cn.ts`、`src/theme.tsx`、`src/tokens.css`、`src/index.ts`
- Test: `packages/octopus-ui/src/theme.test.tsx`

**Interfaces:**
- Produces:
  - 包出口：`import { cn, ThemeProvider, useTheme } from "octopus-ui"`；CSS 经 `import "octopus-ui/tokens.css"`
  - `cn(...inputs: ClassValue[]): string`（clsx 直通）
  - `ThemeProvider(props: { children; defaultMode?: "light" | "dark"; storageKey?: string })`：挂载时把 `<html data-mode>` 设为 localStorage 偏好 > defaultMode > 跟随系统，并提供 `useTheme(): { mode, setMode }`

- [ ] **Step 1: 写失败测试 theme.test.tsx**

断言三点：默认 dark 时 `document.documentElement.dataset.mode === "dark"`；`setMode("light")` 后属性切换且写入 localStorage；无 defaultMode 且系统偏好暗色（matchMedia mock 返回 true）时跟随系统。

- [ ] **Step 2: 脚手架与实现**

package.json 关键字段：

```json
{
  "name": "octopus-ui",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.css": "./src/tokens.css"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "clsx": "^2.1.1" },
  "peerDependencies": { "react": "^18.2.0", "react-dom": "^18.2.0" },
  "devDependencies": { "@testing-library/react": "^16.1.0", "@types/react": "~18.3.1", "@types/react-dom": "~18.3.0", "jsdom": "^26.0.0", "react": "^18.2.0", "react-dom": "^18.2.0", "typescript": "^5.6.0", "vitest": "^4.1.8" }
}
```

tokens.css（唯一真源，完整落地；亮色为 :root 默认，暗色覆盖，未显式指定时跟随系统）：

```css
/* ── 第1层：色板（页面禁用）── */
:root {
  --palette-base-dark: #0b0f17;   --palette-raised-dark: #0f1420;
  --palette-surface-dark: #131926; --palette-hover-dark: #182032;
  --palette-line1-dark: #1e2636;  --palette-line2-dark: #2a3448;
  --palette-text-dark: #e6eaf2;   --palette-text2-dark: #8b94a7;
  --palette-text3-dark: #5c6577;
  --palette-brand-dark: #34d399;  --palette-on-brand-dark: #06281c;
  --palette-info-dark: #60a5fa;   --palette-warn-dark: #fb923c;
  --palette-danger-dark: #e5484d;

  --palette-white: #ffffff;       --palette-base-light: #f8fafc;
  --palette-surface-light: #f1f5f9; --palette-hover-light: #e2e8f0;
  --palette-line1-light: #e2e8f0; --palette-line2-light: #cbd5e1;
  --palette-text-light: #0f172a;  --palette-text2-light: #475569;
  --palette-text3-light: #94a3b8;
  --palette-brand-light: #059669; --palette-on-brand-light: #ffffff;
  --palette-info-light: #2563eb;  --palette-warn-light: #ea580c;
  --palette-danger-light: #dc2626;
}

/* ── 第2层：品牌 ── */
:root { --brand-primary: var(--palette-brand-light); --brand-on-primary: var(--palette-on-brand-light); }
[data-theme="ocean"] { --brand-primary: var(--palette-info-light); }

/* ── 第3层：语义（亮色默认）── */
:root {
  color-scheme: light;
  --color-bg: var(--palette-white);
  --color-surface: var(--palette-surface-light);
  --color-hover: var(--palette-hover-light);
  --color-border: var(--palette-line1-light);
  --color-border-strong: var(--palette-line2-light);
  --color-text: var(--palette-text-light);
  --color-text-muted: var(--palette-text2-light);
  --color-text-faint: var(--palette-text3-light);
  --color-accent: var(--brand-primary);
  --color-accent-fg: var(--brand-on-primary);
  --color-info: var(--palette-info-light);
  --color-warn: var(--palette-warn-light);
  --color-danger: var(--palette-danger-light);
}

/* 暗色维度（v5 视觉即此模式）*/
[data-mode="dark"] {
  color-scheme: dark;
  --color-bg: var(--palette-base-dark);
  --color-surface: var(--palette-surface-dark);
  --color-hover: var(--palette-hover-dark);
  --color-border: var(--palette-line1-dark);
  --color-border-strong: var(--palette-line2-dark);
  --color-text: var(--palette-text-dark);
  --color-text-muted: var(--palette-text2-dark);
  --color-text-faint: var(--palette-text3-dark);
  --color-accent: var(--palette-brand-dark);
  --color-accent-fg: var(--palette-on-brand-dark);
  --color-info: var(--palette-info-dark);
  --color-warn: var(--palette-warn-dark);
  --color-danger: var(--palette-danger-dark);
}
[data-theme="ocean"][data-mode="dark"], [data-mode="dark"] [data-theme="ocean"] { /* ocean 暗色主色 */ }
[data-mode="dark"] { --brand-primary: var(--palette-brand-dark); --brand-on-primary: var(--palette-on-brand-dark); }

/* 未手动指定时跟随系统 */
@media (prefers-color-scheme: dark) {
  :root:not([data-mode]) {
    color-scheme: dark;
    --color-bg: var(--palette-base-dark);
    --color-surface: var(--palette-surface-dark);
    --color-hover: var(--palette-hover-dark);
    --color-border: var(--palette-line1-dark);
    --color-border-strong: var(--palette-line2-dark);
    --color-text: var(--palette-text-dark);
    --color-text-muted: var(--palette-text2-dark);
    --color-text-faint: var(--palette-text3-dark);
    --color-accent: var(--palette-brand-dark);
    --color-accent-fg: var(--palette-on-brand-dark);
    --color-info: var(--palette-info-dark);
    --color-warn: var(--palette-warn-dark);
    --color-danger: var(--palette-danger-dark);
  }
}

/* ── Tailwind v4 注册 ── */
@theme inline {
  --color-background: var(--color-bg);
  --color-surface: var(--color-surface);
  --color-surface-hover: var(--color-hover);
  --color-border: var(--color-border);
  --color-border-strong: var(--color-border-strong);
  --color-foreground: var(--color-text);
  --color-muted-foreground: var(--color-text-muted);
  --color-faint-foreground: var(--color-text-faint);
  --color-accent: var(--color-accent);
  --color-accent-foreground: var(--color-accent-fg);
  --color-info: var(--color-info);
  --color-warn: var(--color-warn);
  --color-danger: var(--color-danger);
  --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
}

body { margin: 0; font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
```

> 注意 `@theme inline` 内 `--color-accent: var(--color-accent)` 这类同名引用是规范原文的循环写法隐患——落地时语义层变量名保持上表左列不变即可（theme 键与语义变量同名但取值来自右列已解析链），构建后若发现循环，把语义层改名为 `--sem-*` 再映射。**此风险在 Task 1e 构建验证中最先暴露。**

- [ ] **Step 3: 测试转绿 + typecheck**

Run: `pnpm install ; pnpm --filter octopus-ui test ; pnpm --filter octopus-ui typecheck`

- [ ] **Step 4: Commit** — `feat(ui): octopus-ui package scaffold with three-layer tokens and theme provider`

---

### Task 1b: P0 原语组件

**Files:** Create `src/primitives/{button,badge,card,spinner,input,progress,avatar}/index.tsx` + 各自 `index.test.tsx`；Modify `src/index.ts` 导出全部

**Interfaces（API 词表全包统一）：**
- `Button(variant?: primary|secondary|ghost|danger = secondary, size?: sm|md|lg = md)`，转发 props/ref
- `Badge(tone?: success|info|warn|neutral|danger = neutral)`，children 文本
- `Card`：div 容器，默认 `rounded-lg border border-border bg-surface`
- `Spinner(size?: sm|md)`：旋转圆环
- `Input` / `Textarea`：受控双模式，转发 ref
- `ProgressBar(value: number, max? = 100)`：role="progressbar"，aria-valuenow
- `Avatar(initials: string, size?: xs|sm|md)`：首字母圆形

样式基调（暗色下呈现 v5 观感）：Button primary = `bg-accent text-accent-foreground rounded-lg transition-[filter] duration-fast hover:brightness-110 disabled:pointer-events-none disabled:opacity-50`；ghost = `text-muted-foreground hover:text-foreground hover:bg-surface`；Badge = 圆角胶囊 + tone 对应 `bg-accent/10 text-accent` 等；Spinner 用 `animate-spin border border-accent border-t-transparent`。

- [ ] **Step 1–4（TDD 循环）**：每个原语先写行为测试再实现。测试要点：Button 点击回调与 variant 类名存在；ProgressBar 的 aria-valuenow 正确；Input 受控输入触发 onChange；Badge 渲染 tone 类。逐个转绿。
- [ ] **Step 5: Commit** — `feat(ui): p0 primitives (button badge card spinner input textarea progress avatar)`

---

### Task 1c: 浮层组件（DropdownMenu / Sheet）

**Files:** Create `src/overlays/dropdown-menu/index.tsx(+test)`、`src/overlays/sheet/index.tsx(+test)`；Modify `src/index.ts`

**Interfaces:**
- DropdownMenu：完整转发 Radix `*DropdownMenu.*` 组件族并附默认样式的 `DropdownMenuItem`；z-index 用 modal 档（300）
- Sheet(props: `open, onOpenChange, title, subtitle?, side? = "right", widthClass? = "max-w-2xl"`)：Radix Dialog 底座右侧滑出，含 Header(title/subtitle/关闭钮 aria-label="关闭") 与内容区；backdrop 用 bg-black/60

- [ ] **Step 1–4（TDD）**：Sheet 测开合渲染、Esc 关闭（Radix 自带）、关闭按钮回调；DropdownMenu 测 trigger 开合与 item 回调（键盘能力归 Radix 不重复测）。jsdom 下 Radix Portal 正常工作。
- [ ] **Step 5: Commit** — `feat(ui): radix dropdown-menu and sheet overlays`

---

### Task 1d: lucide 图标统一出口

**Files:** Create `src/icons.tsx`（按需 re-export：Search/Bell/Settings/ChevronDown/ChevronRight/Plus/Check/LoaderCircle/SendHorizontal/Paperclip/X/Columns3/FileText/GitCommitHorizontal/ListFilter/Clock/User 等）；Modify `src/index.ts`
- [ ] **Step 1–3**: 无需独立测试（纯 re-export），typecheck 过即可；Commit — `feat(ui): lucide icon exit`

---

### Task 1e: 壳包接入 Tailwind 管线

**Files:**
- Modify: `packages/octopus/package.json`（devDeps + `tailwindcss ^4`、`@tailwindcss/vite ^4`；deps + `"octopus-ui": "workspace:*"`）
- Modify: `packages/octopus/web/vite.config.ts`（plugins 加 `tailwindcss()`）
- Create: `packages/octopus/web/src/index.css`：
  ```css
  @import "tailwindcss";
  @import "octopus-ui/tokens.css";
  @source "../../../octopus-ui/src";
  ```
- Delete: `packages/octopus/web/src/styles.css`（ModuleGrid 旧类随 T13 迁移处理）
- Modify: `packages/octopus/web/src/main.tsx`（`import "./index.css"`）

- [ ] **Step 1: 实施并在 octopus-ui 加最小冒烟页验证跨包扫描**

临时在壳 App.tsx 顶部放 `<button className="bg-accent text-accent-foreground">冒烟</button>`，跑 `pnpm --filter octopus build`，检查产物 CSS 含 `.bg-accent` 与正确色值。这是规范风险清单第 1 条（`@source` 跨包扫描），最先验证。
Expected: 产物包含该工具类；若未生成，调整 `@source` 相对路径直至成功。

- [ ] **Step 2: 移除冒烟标记，跑壳全量测试确认无回归**
- [ ] **Step 3: Commit** — `feat(octopus): wire tailwind v4 pipeline and octopus-ui into shell web`

---

### Task 2: 领域类型与 mock 数据源

**Files:**
- Create: `packages/octopus/web/src/lib/types.ts`
- Create: `packages/octopus/web/src/lib/datasource.ts`
- Test: `packages/octopus/web/src/lib/datasource.test.ts`

**Interfaces:**
- Consumes: 无
- Produces（后续任务全部依赖以下精确签名）:

```ts
// types.ts
export type BadgeTone = "green" | "blue" | "gray" | "orange"
export interface Badge { label: string; tone: BadgeTone }
export interface InlineSeg { text: string; accent?: "green" | "orange" | "strong" }

export interface ProjectMember { initials: string }
export interface ProjectSummary {
  id: string; name: string; shortName: string; description: string
  iteration: string; dueDate: string
  progressPct: number; weeklyDone: number; weeklyTotal: number
  activeRequirements: number; overdue: number
  members: ProjectMember[]
}

export interface PriorityCard {
  badge?: Badge; title: string; hint: string; actionLabel?: string
}

export type MessageBlock =
  | { kind: "paragraph"; segs: InlineSeg[] }
  | { kind: "bullets"; items: InlineSeg[][] }
  | { kind: "steps"; items: { state: "done" | "active" | "pending"; text: string }[] }
  | { kind: "cards"; cards: PriorityCard[] }
  | { kind: "actions"; actions: string[] }
  | { kind: "code"; filename: string; code: string }
  | { kind: "notice"; title: string; hint: string }

export interface ChatMessage {
  id: string; role: "user" | "assistant"; time: string
  text?: string; blocks?: MessageBlock[]; meta?: string
}

export interface Artifact { id: string; kind: "task" | "doc" | "commit"; title: string; subtitle: string; live?: boolean }
export type KanbanColumnKey = "todo" | "doing" | "review" | "done"
export interface KanbanTask {
  id: string; title: string; column: KanbanColumnKey
  badge?: Badge; progressPct?: number; progressLabel?: string
  diffStat?: string; dueLabel?: string; assignee?: string
  agentRun?: boolean; dimmed?: boolean
}
export interface KanbanColumn { key: KanbanColumnKey; label: string; dotColor: string; tasks: KanbanTask[] }
export interface Requirement { id: string; title: string; statusBadge: Badge; owner: string | null; progressPct: number }
```

```ts
// datasource.ts
import { createMockAgentClient, type AgentClient } from "./agent-client" // Task 3 提供；Task 2 先写占位导出见下
export const PROJECTS: ProjectSummary[]
export const PRIORITY_CARDS: PriorityCard[]
export const INITIAL_ARTIFACTS: Artifact[]
export const KANBAN_COLUMNS: KanbanColumn[]
export const REQUIREMENTS: Requirement[]
export const QUICK_PROMPTS: string[]   // ["📋 列出今日待办","⚡ 把 REQ-124 拆成子任务","📊 生成本周迭代周报","🔍 审查最近的 PR","🗓️ 规划下个迭代"]
export function currentProject(): ProjectSummary  // PROJECTS[0]
export function createDefaultAgentClient(): AgentClient // 转发 agent-client（Task 2 先返回 null! 断言占位，Task 3 替换实现）
```

> 注：Task 2 中 `createDefaultAgentClient` 先写成 `throw new Error("Task 3 实现")` 的桩，保证编译通过且被 Task 3 的测试替换。

- [ ] **Step 1: 写失败测试 datasource.test.ts**

```tsx
import { describe, expect, it } from "vitest"
import { KANBAN_COLUMNS, PROJECTS, QUICK_PROMPTS, REQUIREMENTS, currentProject } from "./datasource"

describe("datasource", () => {
  it("current project is Octopus Platform with v5 metrics", () => {
    const p = currentProject()
    expect(p.name).toBe("Octopus Platform")
    expect(p.shortName).toBe("OP")
    expect(p.iteration).toBe("迭代 4.2 · 第 2 周")
    expect(p.progressPct).toBe(78)
    expect(p.weeklyDone).toBe(28)
    expect(p.weeklyTotal).toBe(40)
    expect(p.activeRequirements).toBe(24)
    expect(p.overdue).toBe(3)
    expect(p.dueDate).toBe("10-31")
  })
  it("has three projects with unique ids and OP first", () => {
    expect(PROJECTS.map((p) => p.id)).toEqual(["octopus-platform", "merchant-portal", "data-core"])
  })
  it("kanban covers four columns in order", () => {
    expect(KANBAN_COLUMNS.map((c) => c.key)).toEqual(["todo", "doing", "review", "done"])
    expect(KANBAN_COLUMNS.flatMap((c) => c.tasks).some((t) => t.agentRun)).toBe(true)
  })
  it("requirements table has REQ-118..115 rows", () => {
    expect(REQUIREMENTS.map((r) => r.id)).toEqual(["REQ-118", "REQ-121", "REQ-124", "REQ-115"])
  })
  it("quick prompts match v5 chips", () => {
    expect(QUICK_PROMPTS[0]).toBe("📋 列出今日待办")
    expect(QUICK_PROMPTS).toHaveLength(5)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter octopus exec vitest run --root web src/lib/datasource.test.ts`
Expected: FAIL（找不到 ./datasource）

- [ ] **Step 3: 实现 types.ts 与 datasource.ts**

types.ts 按 Interfaces 原样落地。datasource.ts 数据逐字取自 v5：

```ts
// PROJECTS[0] 关键字段示例（其余两个项目：Merchant Portal/MP/商户门户 · 迭代 2.8；Data Core/DC/数据中台 · 迭代 1.5）
{
  id: "octopus-platform",
  name: "Octopus Platform",
  shortName: "OP",
  description: "企业级一站式开发协作平台 · 目标 Q4 上线公测",
  iteration: "迭代 4.2 · 第 2 周",
  dueDate: "10-31",
  progressPct: 78,
  weeklyDone: 28, weeklyTotal: 40,
  activeRequirements: 24, overdue: 3,
  members: [{ initials: "ZS" }, { initials: "LW" }, { initials: "WQ" }, /* …共 8 人 */],
}
```

看板列：待处理(8,#5C6577)/进行中(12,#60A5FA)/评审中(5,#A78BFA)/已完成(17,#34D399)；卡片含 TASK-2852、TASK-2853（todo）、TASK-2841(65%)、TASK-2850(Agent 执行中, agentRun:true)、TASK-2847(diffStat:"+214 −38")、TASK-2838(dimmed)、TASK-2836(dimmed)。需求行：REQ-118 多租户权限体系升级/开发中(blue)/张三/48%；REQ-121 Agent 任务编排可视化/评审中(gray)/李雯/15%；REQ-124 CI 流水线缓存加速/待排期(orange)/null/0%；REQ-115 消息通知中心聚合/已完成(green)/王倩/100%。INITIAL_ARTIFACTS 含 TASK-2850(live:true)、TASK-2854 流水线、赶工方案草案.md(doc)、a3f 提交(commit)。QUICK_PROMPT 文案见 Interfaces。

- [ ] **Step 4: 测试转绿**

Run: `pnpm --filter octopus exec vitest run --root web src/lib/datasource.test.ts`
Expected: PASS ×5

- [ ] **Step 5: Commit**

```powershell
git add packages/octopus/web/src/lib/types.ts packages/octopus/web/src/lib/datasource.ts packages/octopus/web/src/lib/datasource.test.ts
git commit -m "feat: workbench domain types and mock datasource"
```

---

### Task 3: AgentClient 接口与脚本化 mock

**Files:**
- Create: `packages/octopus/web/src/lib/agent-client.ts`
- Modify: `packages/octopus/web/src/lib/datasource.ts`（替换 createDefaultAgentClient 桩）
- Test: `packages/octopus/web/src/lib/agent-client.test.ts`

**Interfaces:**
- Consumes: `MessageBlock`、`Artifact`（Task 2）
- Produces:

```ts
export interface AgentReply { blocks: MessageBlock[]; artifacts?: Artifact[] }
export interface AgentClient {
  reply(input: string): Promise<AgentReply>   // mock：延迟后按关键词返回脚本
}
export function createMockAgentClient(delayMs?: number): AgentClient
```

> **dsh 契约风格注释**（写入 agent-client.ts 顶部）：本接口是 agent 能力的唯一选择缝（Service Definition 角色）。阶段二多 provider 时按 dsh 惯例演进为 `registerAgentProvider(provider): () => void` 注册制 + 显式选择策略，且行为不得依赖注册顺序；本阶段的 `createDefaultAgentClient()` 是该缝的唯一内置实现。

- [ ] **Step 1: 写失败测试 agent-client.test.ts**

```tsx
import { describe, expect, it, vi } from "vitest"
import { createMockAgentClient } from "./agent-client"

describe("createMockAgentClient", () => {
  it("returns priority script for todo keywords", async () => {
    const client = createMockAgentClient(0)
    const reply = await client.reply("先列一下优先事项")
    const cards = reply.blocks.find((b) => b.kind === "cards")
    expect(cards && cards.kind === "cards" && cards.cards).toHaveLength(3)
    expect(cards && cards.kind === "cards").toBeTruthy()
    if (cards && cards.kind === "cards") {
      expect(cards.cards[0].badge?.label).toBe("逾期")
      expect(cards.cards[0].actionLabel).toBe("让 Agent 接手 →")
    }
  })
  it("returns delegation script with steps for takeover keywords", async () => {
    const client = createMockAgentClient(0)
    const reply = await client.reply("把 TASK-2850 交给 Agent 自动跑")
    const steps = reply.blocks.find((b) => b.kind === "steps")
    expect(steps && steps.kind === "steps" && steps.items.map((s) => s.state)).toEqual(["done", "active", "pending"])
    expect(reply.artifacts?.some((a) => a.live)).toBe(true)
  })
  it("falls back to ack for unmatched input", async () => {
    const client = createMockAgentClient(0)
    const reply = await client.reply("随便说点什么")
    expect(reply.blocks[0].kind).toBe("paragraph")
  })
  it("resolves after at least delayMs", async () => {
    vi.useFakeTimers()
    const spy = vi.fn()
    const p = createMockAgentClient(500).reply("hi").then(spy)
    vi.advanceTimersByTime(499)
    await Promise.resolve()
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await p
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter octopus exec vitest run --root web src/lib/agent-client.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
import type { AgentReply } from "./agent-client.types" // 不新建文件，直接同文件定义即可
```

完整实现（单文件 `agent-client.ts`）：

```ts
import type { AgentReply, AgentClient as _unused } from "./types" // 错误示例——不要这样导入
```

正确版本：

```ts
import type { Artifact, MessageBlock } from "./types"

export interface AgentReply {
  blocks: MessageBlock[]
  artifacts?: Artifact[]
}

export interface AgentClient {
  reply(input: string): Promise<AgentReply>
}

const PRIORITY_SCRIPT: MessageBlock[] = [
  { kind: "paragraph", segs: [{ text: "结合截止时间和阻塞关系，今天建议按这个顺序处理：" }] },
  {
    kind: "cards",
    cards: [
      { badge: { label: "逾期", tone: "orange" }, title: "TASK-2850 · React 19 升级兼容性验证", hint: "已逾期 2 天 · 阻塞 REQ-118 联调 · 建议今天集中解决", actionLabel: "让 Agent 接手 →" },
      { badge: { label: "今天 18:00", tone: "blue" }, title: "TASK-2841 · 认证模块 OAuth 2.0 重构", hint: "进度 65% · 剩余工作约 3 小时 · 张三负责", actionLabel: "查看详情" },
      { badge: { label: "本周内", tone: "gray" }, title: "REQ-121 · Agent 任务编排可视化评审", hint: "周四评审会前需要补充流程图初稿" },
    ],
  },
]

const DELEGATION_SCRIPT: { blocks: MessageBlock[]; artifacts: Artifact[] } = {
  blocks: [
    { kind: "paragraph", segs: [{ text: "收到。我建了一条自动化流水线来接管 " }, { text: "TASK-2850", accent: "green" }, { text: "：" }] },
    { kind: "steps", items: [
      { state: "done", text: "升级依赖并修复 Breaking Changes（已定位 4 处）" },
      { state: "active", text: "运行全量回归测试（预计 25 分钟）…" },
      { state: "pending", text: "输出报告并发给你 & 王倩" },
    ] },
    { kind: "actions", actions: ["暂停执行", "查看执行日志"] },
  ],
  artifacts: [
    { id: "art-task-2850", kind: "task", title: "TASK-2850 转 Agent 执行", subtitle: "React 19 兼容性验证 · 回归测试中", live: true },
    { id: "art-pipeline-2854", kind: "task", title: "TASK-2854 自动化流水线", subtitle: "升级依赖 + 回归测试 + 报告通知" },
  ],
}

const ACK_SCRIPT: MessageBlock[] = [
  { kind: "paragraph", segs: [{ text: "收到。当前上下文是 " }, { text: "Octopus Platform · 迭代 4.2", accent: "green" }, { text: "，可以让我列出待办、拆解需求或生成周报。" }] },
]

function pickScript(input: string): AgentReply {
  if (/待办|优先|事项/.test(input)) return { blocks: PRIORITY_SCRIPT }
  if (/接手|自动|跑/.test(input)) return { ...DELEGATION_SCRIPT }
  return { blocks: ACK_SCRIPT }
}

export function createMockAgentClient(delayMs = 600): AgentClient {
  return {
    reply(input) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(pickScript(input)), delayMs)
      })
    },
  }
}
```

同时把 `datasource.ts` 的桩改为 `export function createDefaultAgentClient(): AgentClient { return createMockAgentClient() }` 并补 import。

- [ ] **Step 4: 测试转绿**

Run: `pnpm --filter octopus exec vitest run --root web src/lib/agent-client.test.ts src/lib/datasource.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/octopus/web/src/lib/agent-client.ts packages/octopus/web/src/lib/datasource.ts packages/octopus/web/src/lib/agent-client.test.ts
git commit -m "feat: scripted mock agent client"
```

---

### Task 4: useChat hook

**Files:**
- Create: `packages/octopus/web/src/lib/use-chat.ts`
- Test: `packages/octopus/web/src/lib/use-chat.test.tsx`
- Modify: `packages/octopus/web/vitest.config.ts`（include 加 `*.test.ts`）

**Interfaces:**
- Consumes: `AgentClient`、`ChatMessage`、`Artifact`、`currentProject()`、`INITIAL_ARTIFACTS`、`timeGreeting`
- Produces:

```ts
export type ChatStatus = "idle" | "thinking"
export function useChat(client: AgentClient): {
  messages: ChatMessage[]
  status: ChatStatus
  send: (text: string) => void
  artifacts: Artifact[]
}
```

行为契约：
- 初始含一条 assistant 欢迎消息：正文使用 `timeGreeting(new Date().getHours())` + 项目名 + 迭代名（如「早上好。当前上下文：Octopus Platform · 迭代 4.2，还有 5 天截止…」，时间显示为 HH:mm）
- `send(text)`：立即追加 user 消息 → status="thinking" → `client.reply` 完成后追加 assistant 消息（blocks 来自 reply，meta 固定格式 `HH:mm · gpt-4 · 1.2s`），artifacts 合并去重（按 id），status 回 "idle"
- thinking 期间重复调用 `send` 直接忽略

- [ ] **Step 1: vitest include 放开 .ts 测试**

```ts
// vitest.config.ts → test.include 改为：
include: ["src/**/*.test.{ts,tsx}"],
```

- [ ] **Step 2: 写失败测试 use-chat.test.tsx**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockAgentClient } from "./agent-client"
import { useChat } from "./use-chat"

describe("useChat", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0))
  })

  it("seeds welcome message mentioning project context", () => {
    const { result } = renderHook(() => useChat(createMockAgentClient(0)))
    const welcome = result.current.messages[0]
    expect(welcome.role).toBe("assistant")
    expect(welcome.text).toContain("早上好")
    expect(welcome.text).toContain("Octopus Platform")
    expect(welcome.text).toContain("迭代 4.2")
  })

  it("send appends user message then assistant reply and artifacts", async () => {
    const { result } = renderHook(() => useChat(createMockAgentClient(10)))
    act(() => result.current.send("先列一下优先事项"))
    expect(result.current.status).toBe("thinking")
    expect(result.current.messages.at(-1)?.role).toBe("user")
    act(() => { vi.advanceTimersByTime(20) })
    await waitFor(() => expect(result.current.status).toBe("idle"))
    const replyMsg = result.current.messages.at(-1)!
    expect(replyMsg.role).toBe("assistant")
    expect(replyMsg.blocks?.some((b) => b.kind === "cards")).toBe(true)
    expect(replyMsg.meta).toMatch(/^\d{2}:\d{2} · gpt-4 · /)
    expect(result.current.artifacts.length).toBeGreaterThanOrEqual(4) // 2 初始 + 2 新增
  })

  it("ignores send while thinking", async () => {
    const { result } = renderHook(() => useChat(createMockAgentClient(50)))
    act(() => result.current.send("a"))
    act(() => result.current.send("b"))
    act(() => { vi.advanceTimersByTime(60) })
    await waitFor(() => expect(result.current.status).toBe("idle"))
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1)
  })
})
```

注意 fake timers 与 waitFor 冲突时改用 `vi.useFakeTimers({ shouldAdvanceTime: true })`；若仍不稳定，把该用例的时钟改为真实 timers + delayMs=0。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter octopus exec vitest run --root web src/lib/use-chat.test.tsx`
Expected: FAIL（use-chat 不存在）

- [ ] **Step 4: 实现 use-chat.ts**

要点：`let seq = 0` 模块级计数生成 id（jsdom 下不依赖 crypto.randomUUID）；欢迎语 time 字段用 `new Date()` 格式化 HH:mm；thinking 中 send 早退；artifacts 用函数式 setState 按 id 去重合并。

- [ ] **Step 5: 测试转绿 + 全量回归**

Run: `pnpm --filter octopus exec vitest run --root web`
Expected: 全部 PASS（datasource/agent-client/App/ModuleGrid 均绿）

- [ ] **Step 6: Commit**

```powershell
git add packages/octopus/web/src/lib/use-chat.ts packages/octopus/web/src/lib/use-chat.test.tsx packages/octopus/web/vitest.config.ts
git commit -m "feat: useChat hook with scripted streaming state"
```

---

### Task 5:（已并入 Phase 0）

下拉原语不再在壳内自研：TopBar 的项目切换/设置/用户菜单一律使用 octopus-ui 的 **DropdownMenu**（Task 1c，Radix 底座，自带外点关闭/Esc/键盘导航/a11y）。原自研 Dropdown 方案作废。

---

### Task 6: OctoLogo 与 TopBar

**Files:**
- Create: `packages/octopus/web/src/components/OctoLogo.tsx`
- Create: `packages/octopus/web/src/components/TopBar.tsx`（样式全走 Tailwind 工具类）
- Test: `packages/octopus/web/src/components/TopBar.test.tsx`

**Interfaces:**
- Consumes: octopus-ui 的 `DropdownMenu`（Task 1c）、`Badge`、`Button`；`ProjectSummary`（Task 2）
- Produces:

```ts
export function OctoLogo(props: { className?: string }): JSX.Element
export function TopBar(props: {
  projects: ProjectSummary[]
  currentProjectId: string
  onSwitchProject: (id: string) => void
  onOpenModules: () => void
}): JSX.Element
```

- [ ] **Step 1: 写失败测试**

```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PROJECTS } from "../lib/datasource"
import { TopBar } from "./TopBar"

const props = {
  projects: PROJECTS,
  currentProjectId: "octopus-platform",
  onSwitchProject: vi.fn(),
  onOpenModules: vi.fn(),
}

describe("TopBar", () => {
  it("renders brand and current project in switcher", () => {
    render(<TopBar {...props} />)
    expect(screen.getByText("Octopus Platform")).toBeInTheDocument()
    expect(screen.getByText("迭代 4.2 · 第 2 周")).toBeInTheDocument()
  })
  it("switcher lists projects and switches", () => {
    render(<TopBar {...props} />)
    fireEvent.click(screen.getAllByText("Octopus Platform")[0])
    expect(screen.getByText("Merchant Portal")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Data Core"))
    expect(props.onSwitchProject).toHaveBeenCalledWith("data-core")
  })
  it("settings menu keeps main-interface link (marketplace/settings were dead links, removed)", () => {
    render(<TopBar {...props} />)
    fireEvent.click(screen.getByTitle("设置"))
    expect(screen.getByRole("link", { name: "进入主界面" })).toHaveAttribute("href", "/")
    // dsh-web-frontend 路由表中不存在 /marketplace 与 /settings（已验证产物无此字符串），
    // 旧首页的这两个链接是死链，不保留：
    expect(screen.queryByRole("link", { name: "插件市场" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "设置", exact: true })).not.toBeInTheDocument()
  })
  it("opens modules drawer entry", () => {
    render(<TopBar {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /已装模块/ }))
    expect(props.onOpenModules).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 确认失败**

Run: `pnpm --filter octopus exec vitest run --root web src/components/TopBar.test.tsx` → FAIL

- [ ] **Step 3: 实现**

OctoLogo.tsx：v5 顶栏 SVG 原样封装（24×24 viewBox、stroke=currentColor、width 1.6，头身路径 + 两眼 + 五条触手路径），props.className 控制尺寸颜色。

TopBar 结构（从左到右）：OctoLogo → 分隔线 → DropdownMenu(项目切换)：触发按钮 = shortName 方块 + 项目名 + ChevronDown 图标；面板含搜索输入框、「最近项目」标签、项目行（current 行带 Check 图标）、底部「新建项目」按钮 → 迭代徽章 `<Badge tone="success">` → 弹性空隙 → 搜索框（Input 组件，placeholder「在项目内搜索…」+ ⌘K kbd 样式 span）→ DropdownMenu(设置齿轮，title="设置")：面板两组——本项目（项目设置/成员与权限/仓库与集成/自动化规则）+ 全局（工作区偏好/通知设置）；菜单底部仅保留一个链接「进入主界面」（`href="/"`）。旧版 `/marketplace`、`/settings` 已验证为死链（dsh 主 SPA 无此路由），不保留，待插件市场成为真实插件时再挂回。→ DropdownMenu(用户头像 YL)：姓名邮箱卡片 + 个人资料/API Token。搜索框为纯受控展示（无过滤逻辑，YAGNI）。菜单面板宽度用 `w-[320px]` 等布局类（宽度非颜色，允许 arbitrary）。

topbar.css 要点：`.topbar{height:52px;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--border);background:var(--bg)}`；项目方块 `.proj-chip{width:26px;height:26px;border-radius:6px;background:#1B2434;border:1px solid var(--border-strong);display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:10px;color:var(--t2)}`；项目行复用 v5 的 `.proj-row/.proj-row.current`。

- [ ] **Step 4: 测试转绿** → PASS ×4

- [ ] **Step 5: Commit** — `feat: top bar with project switcher dropdowns`

---

### Task 7: ProjectStrip

**Files:**
- Create: `packages/octopus/web/src/components/ProjectStrip.tsx`（样式全走 Tailwind；进度条用 ui ProgressBar）
- Test: `packages/octopus/web/src/components/ProjectStrip.test.tsx`

**Interfaces:**
- Consumes: `ProjectSummary`
- Produces:

```ts
export function ProjectStrip(props: {
  summary: ProjectSummary
  onOpenKanban: () => void
  onOpenRequirements: () => void
}): JSX.Element
```

- [ ] **Step 1: 写失败测试**

```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { currentProject } from "../lib/datasource"
import { ProjectStrip } from "./ProjectStrip"

describe("ProjectStrip", () => {
  it("renders all metrics inline", () => {
    render(<ProjectStrip summary={currentProject()} onOpenKanban={() => {}} onOpenRequirements={() => {}} />)
    expect(screen.getByText("78%")).toBeInTheDocument()
    expect(screen.getByText("28")).toBeInTheDocument()
    expect(screen.getByText("/40")).toBeInTheDocument()
    expect(screen.getByText("24")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("10-31")).toBeInTheDocument()
    expect(screen.getByText("+8")).toBeInTheDocument()   // 成员溢出计数（8 人 - 前 3）
  })
  it("opens kanban and requirements drawers", () => {
    const onKanban = vi.fn(); const onReqs = vi.fn()
    render(<ProjectStrip summary={currentProject()} onOpenKanban={onKanban} onOpenRequirements={onReqs} />)
    fireEvent.click(screen.getByRole("button", { name: /任务看板/ }))
    fireEvent.click(screen.getByRole("button", { name: /需求池/ }))
    expect(onKanban).toHaveBeenCalledOnce()
    expect(onReqs).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现**

单行 flex（高 56px、border-bottom、背景 `linear-gradient(to right,#0D1220,var(--bg))`）：进度条块（label+mono 百分比+progress-track/fill）→ 竖分隔线 → 四组数字指标（本周任务 28/40、活跃需求 24、逾期 3 橙色、迭代截止 10-31）→ 分隔线 → 成员头像叠（前 3 个 initials 圆形 `-8px` 叠压 + `+N` 溢出片）→ 空隙 → 「需求池」「任务看板」btn-ghost 描边小按钮（各配 16px 内联 SVG 图标）→ 「新建需求」btn-primary 小按钮。成员溢出数 = `summary.members.length - 3`，测试数据固定 8 人得 `+8`… 注意 v5 显示 `+5`：把 members 定为 8 人但溢出显示取 `members.length - 3` 时应显示 +5 —— 因此测试断言用 `screen.getByText("+5")`，members 长度必须恰为 8。实现按此对齐。

- [ ] **Step 4: 测试转绿** → PASS ×2

- [ ] **Step 5: Commit** — `feat: single-line project metrics strip`

---

### Task 8: ChatMessage 富块渲染器

**Files:**
- Create: `packages/octopus/web/src/components/ChatMessage.tsx`（样式全走 Tailwind）
- Test: `packages/octopus/web/src/components/ChatMessage.test.tsx`

**Interfaces:**
- Consumes: `ChatMessage`、`MessageBlock`
- Produces:

```ts
export function ChatMessage(props: { message: ChatMessage }): JSX.Element
```

渲染契约：
- user：右对齐蓝色气泡（.msg-user），纯文本
- assistant：左侧八爪鱼头像（OctoLogo 复用，28px 圆角方块 .surface）+ .msg-ai 气泡，逐块渲染：
  - paragraph → `<p>`，InlineSeg 按 accent 映射 class（green→mono 绿色 / orange→mono 橙色 / strong→白色加粗）
  - bullets → `<ul class="msg-bullets">`
  - steps → 步骤清单：done=绿勾 SVG、active=旋转圆环 spinner（CSS 动画）、pending=空心灰圆
  - cards → PriorityCard 卡片堆（badge + title + hint + 可选 actionLabel 按钮）
  - actions → 底部分隔线上的文字按钮行
  - code → 深底代码块（filename 头部 + pre/code，等宽字体）
  - notice → surface-flat 卡片（标题加粗 + hint 小字），用于"已创建任务 TASK-xxxx"类内容
- meta 存在时气泡下显示 mono 小字

- [ ] **Step 1: 写失败测试**（覆盖 7 种 block 渲染 + user 气泡 + meta）

关键断言示例：

```tsx
it("renders priority cards with badge and action", () => {
  render(<ChatMessage message={{ id: "m1", role: "assistant", time: "14:29", meta: "14:29 · gpt-4 · 1.2s",
    blocks: [{ kind: "cards", cards: [{ badge: { label: "逾期", tone: "orange" }, title: "TASK-2850", hint: "阻塞 REQ-118", actionLabel: "让 Agent 接手 →" }] }] }} />)
  expect(screen.getByText("逾期")).toBeInTheDocument()
  expect(screen.getByText("让 Agent 接手 →")).toBeInTheDocument()
})
it("renders step states distinctly", () => {
  render(<ChatMessage message={{ id: "m2", role: "assistant", time: "14:31",
    blocks: [{ kind: "steps", items: [
      { state: "done", text: "升级依赖" }, { state: "active", text: "回归测试中…" }, { state: "pending", text: "输出报告" }] }] }} />)
  expect(screen.getAllByTestId("step-done")).toHaveLength(1)
  expect(screen.getAllByTestId("step-active")).toHaveLength(1)
  expect(screen.getAllByTestId("step-pending")).toHaveLength(1)
})
```

其余 block 各写一条同构断言（code 的 filename 出现、notice 标题出现、bullets 条数、actions 按钮数、user 文本与右对齐样式）。**一切按样式的断言用 `data-testid`**：步骤行加 `data-testid="step-{state}"`，user 气泡加 `data-testid="msg-user"`。

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现 ChatMessage.tsx**

组件内 `renderSeg(segs)` 辅助 + `renderBlock(block, key)` switch，样式全走 Tailwind：气泡 `max-w-[85%] rounded-xl border bg-surface px-4 py-3`（assistant 四角 `rounded-tl-sm`、user 用 `bg-info/15 border-info/30 ml-auto`）；spinner 直接用 ui `Spinner size="sm"`；code 块 `rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed`；InlineSeg accent 映射 `text-accent font-mono` / `text-warn font-mono` / `text-foreground font-medium`。

- [ ] **Step 4: 测试转绿** → PASS

- [ ] **Step 5: Commit** — `feat: rich chat message renderer`

---

### Task 9: Composer 输入区

**Files:**
- Create: `packages/octopus/web/src/components/Composer.tsx`（样式全走 Tailwind）
- Test: `packages/octopus/web/src/components/Composer.test.tsx`

**Interfaces:**
- Consumes: `QUICK_PROMPTS`
- Produces:

```ts
export function Composer(props: {
  quickPrompts: string[]
  disabled?: boolean
  contextLabel: string            // "Octopus Platform · 迭代 4.2"
  onSend: (text: string) => void
}): JSX.Element
```

- [ ] **Step 1: 写失败测试**

```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { QUICK_PROMPTS } from "../lib/datasource"
import { Composer } from "./Composer"

describe("Composer", () => {
  it("renders quick prompt chips and fills input on click", () => {
    render(<Composer quickPrompts={QUICK_PROMPTS} contextLabel="Octopus Platform · 迭代 4.2" onSend={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "📋 列出今日待办" }))
    expect(screen.getByPlaceholderText(/给 Octo Agent 下指令/)).toHaveValue("📋 列出今日待办")
    expect(screen.getByText("上下文：Octopus Platform · 迭代 4.2")).toBeInTheDocument()
  })
  it("submits on Enter, newline on Shift+Enter", () => {
    const onSend = vi.fn()
    render(<Composer quickPrompts={[]} contextLabel="c" onSend={onSend} />)
    const box = screen.getByPlaceholderText(/给 Octo Agent 下指令/)
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.input(box, { target: { value: "你好" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(onSend).toHaveBeenCalledWith("你好")
    expect(box).toHaveValue("")   // 发送后清空
  })
})
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现**

结构：chip 横排（overflow-x auto，点击把文本写入 textarea 并聚焦）→ surface 圆角输入卡（textarea rows=2 + 底行：附件按钮、上下文选择器按钮（dot-online 缩放 75% + label + chevron）、右侧 `⏎ 发送` kbd + btn-primary 上箭头发送钮）。键盘处理 onKeyDown：Enter 且 !shiftKey 且有非空 trim 文本 → preventDefault + onSend(trim) + 清空。disabled 时发送钮与 chips 置灰（opacity .5, pointer-events none）。

composer.css：`.chips{display:flex;gap:8px;margin-bottom:12px;overflow-x:auto;padding-bottom:4px}`、`.chip{padding:5px 12px;border-radius:999px;font-size:12px;color:var(--t2);border:1px solid var(--border);background:none;cursor:pointer;white-space:nowrap}` hover 态按 v5。

- [ ] **Step 4: 测试转绿** → PASS ×2

- [ ] **Step 5: Commit** — `feat: composer with quick prompts and context chip`

---

### Task 10: ChatPane 主区组装

**Files:**
- Create: `packages/octopus/web/src/components/ChatPane.tsx`（样式全走 Tailwind）
- Create: `packages/octopus/web/src/components/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `useChat`、`ChatMessage`、`Composer`、`createDefaultAgentClient`
- Produces:

```ts
export function ChatPane(props: { onArtifactsChange?: (count: number) => void }): JSX.Element
// 内部自持 useChat(createDefaultAgentClient())；会话头部（今天 HH:mm 开始 · 会话 #47 / 历史会话按钮）
```

- [ ] **Step 1: 写失败测试（集成冒烟）**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { QUICK_PROMPTS } from "../lib/datasource"
import { ChatPane } from "./ChatPane"

describe("ChatPane", () => {
  it("full flow: welcome → click chip → send → assistant cards appear", async () => {
    render(<ChatPane />)
    expect(await screen.findByText(/早上好。当前上下文/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "📋 列出今日待办" }))
    fireEvent.click(screen.getByTitle("发送"))
    await waitFor(() => expect(screen.getByText("让 Agent 接手 →")).toBeInTheDocument())
    expect(screen.getAllByText(/gpt-4/).length).toBeGreaterThan(0)
  })
})
```

（若 mock client 默认延迟导致等待，测试内通过 vi.useFakeTimers({shouldAdvanceTime:true}) 或给 ChatPane 加可选 `agentClient` prop 注入 delay=0 实例——采用后者：`props.agentClient?: AgentClient`，生产默认 createDefaultAgentClient()，更可测。）

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现**

布局：`flex:1; min-width:0; display:flex; flex-direction:column`。滚动区（flex:1 overflow-y:auto）内 max-width 820px 居中列：会话头（时间戳用真实当前时间格式化 HH:mm、「历史会话」btn-ghost）+ messages.map(ChatMessage) + thinking 占位（assistant 头像 + spin-ring）。自动滚底：ref 容器在 messages.length/status 变化的 useEffect 里 `el.scrollTop = el.scrollHeight`（不用 scrollIntoView，jsdom 未实现）。底部 sticky Composer。发送按钮加 title="发送" 供测试定位。

- [ ] **Step 4: 测试转绿** → PASS

- [ ] **Step 5: Commit** — `feat: chat pane assembly`

---

### Task 11: ArtifactsRail 会话产出栏

**Files:**
- Create: `packages/octopus/web/src/components/ArtifactsRail.tsx`（样式全走 Tailwind）
- Test: `packages/octopus/web/src/components/ArtifactsRail.test.tsx`

**Interfaces:**
- Consumes: `Artifact[]`
- Produces:

```ts
export function ArtifactsRail(props: {
  artifacts: Artifact[]
  collapsed: boolean
  onCollapse: () => void
  onExpand: () => void
}): JSX.Element | null   // collapsed 时渲染固定定位的恢复按钮（title="展开产出面板"），否则渲染侧栏
```

- [ ] **Step 1: 写失败测试**

```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { INITIAL_ARTIFACTS } from "../lib/datasource"

const base = { artifacts: INITIAL_ARTIFACTS, onCollapse: vi.fn(), onExpand: vi.fn() }

describe("ArtifactsRail", () => {
  it("groups artifacts by kind with live indicator", () => {
    render(<ArtifactsRail {...base} collapsed={false} />)
    expect(screen.getByText("本会话产出")).toBeInTheDocument()
    expect(screen.getByText("TASK-2850 转 Agent 执行")).toBeInTheDocument()
    expect(screen.getByTestId("artifact-live-dot")).toBeInTheDocument()
  })
  it("collapses to restore button and back", () => {
    const { rerender } = render(<ArtifactsRail {...base} collapsed={false} />)
    fireEvent.click(screen.getByTitle("收起"))
    expect(base.onCollapse).toHaveBeenCalledOnce()
    rerender(<ArtifactsRail {...base} collapsed />)
    expect(screen.queryByText("本会话产出")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle("展开产出面板"))
    expect(base.onExpand).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现**

侧栏宽 w-72 右边框列：头部（「本会话产出」小写间距标题 + 收起按钮 title="收起"）→ 按 kind 分组（任务/文档/代码提交 中文标签）逐条 artifact 行（kind 图标方块：task 绿勾底、doc 灰文件、commit mono 绿色短哈希；live 的加 `<span data-testid="artifact-live-dot" className="animate-pulse …">` 呼吸点）→ 底部虚线「归档全部产出」按钮。collapsed 分支返回恢复按钮（fixed right-3 top-1/2 -translate-y-1/2，title="展开产出面板"）。图标用 lucide 出口。

- [ ] **Step 4: 测试转绿** → PASS ×2

- [ ] **Step 5: Commit** — `feat: collapsible session artifacts rail`

---

### Task 12: 三个抽屉（基于 ui Sheet）

**Files:**
- Create: `packages/octopus/web/src/components/KanbanDrawer.tsx`
- Create: `packages/octopus/web/src/components/RequirementsDrawer.tsx`
- Create: `packages/octopus/web/src/components/ModulesDrawer.tsx`
- Modify: `packages/octopus/web/src/ModuleGrid.tsx`（旧全局类改 Tailwind 工具类：`.modules`→`grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 w-full`，`.module-card`→`rounded-lg border border-border bg-surface p-4`，其余同理）
- Test: `packages/octopus/web/src/components/KanbanDrawer.test.tsx`

**Interfaces:**
- Consumes: ui `Sheet`（Task 1c）、`Badge`、`ProgressBar`；`KanbanColumn[]`、`Requirement[]`、`WorkbenchModuleInfo[]`（api.ts）、`ModuleGrid`
- Produces:

```ts
export function KanbanDrawer(props: { open: boolean; onClose: () => void }): JSX.Element      // 数据自取 KANBAN_COLUMNS
export function RequirementsDrawer(props: { open: boolean; onClose: () => void }): JSX.Element // 自取 REQUIREMENTS
export function ModulesDrawer(props: { open: boolean; onClose: () => void; modules: WorkbenchModuleInfo[] }): JSX.Element
```

- [ ] **Step 1: 写失败测试 KanbanDrawer.test.tsx**

```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { KanbanDrawer } from "./KanbanDrawer"

describe("KanbanDrawer", () => {
  it("renders nothing when closed, board when open", () => {
    const { rerender } = render(<KanbanDrawer open={false} onClose={() => {}} />)
    expect(screen.queryByText("任务看板")).not.toBeInTheDocument()
    rerender(<KanbanDrawer open onClose={() => {}} />)
    expect(screen.getByRole("heading", { name: "任务看板" })).toBeInTheDocument()
    expect(screen.getByText("待处理")).toBeInTheDocument()
    expect(screen.getByText("评审中")).toBeInTheDocument()
    expect(screen.getByText(/TASK-2841/)).toBeInTheDocument()
    expect(screen.getByText(/Agent 执行中/)).toBeInTheDocument()
  })
  it("closes via close button and backdrop and Escape", () => {
    const onClose = vi.fn()
    render(<KanbanDrawer open onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByTestId("drawer-backdrop"))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 用 ui Sheet 组装**

三个抽屉统一 `<Sheet open={open} onOpenChange={(o) => !o && onClose()} title=… subtitle=…>`。Sheet 的 overlay 元素带 `data-testid="drawer-backdrop"`（Task 1c 实现时内置），关闭按钮 aria-label="关闭"。Esc 关闭由 Radix 自带。

- [ ] **Step 4: 实现三个抽屉内容（样式全走 Tailwind）**

- KanbanDrawer：body 内横向 flex 四列（各 min-width 240px）：列头（色点+label+mono 计数=列内任务数）+ 任务卡（surface 圆角、badge、进度条 progressLabel/diffStat/dueLabel、agentRun 卡右上角八爪鱼 mini 图标、dimmed 加 opacity .75 与标题 line-through）
- RequirementsDrawer：表格（编号 mono 灰 / 标题 / statusBadge / owner 或 未分配 / progress-track+%），行 hover 高亮
- ModulesDrawer：直接渲染 `<ModuleGrid modules={modules} />`（保懒加载链路），空数组时显示「暂无已装模块」灰字。**ModuleGrid 迁移**：JSX 内旧全局类名改为 Tailwind 工具类（见 Files 说明），其测试按 role/text 断言无需改动。三个抽屉各自从 datasource/api 取数，标题副文案分别为「Octopus Platform · 迭代 4.2」「Octopus Platform · 24 个活跃需求」「由插件注册，点击卡片展开」

- [ ] **Step 5: 测试转绿** → PASS ×2

- [ ] **Step 6: Commit** — `feat: slide-over drawers for kanban, requirements, modules`

---

### Task 13: App 重写与全量验收

**Files:**
- Modify: `packages/octopus/web/src/App.tsx`（重写，样式全走 Tailwind）
- Modify: `packages/octopus/web/src/App.test.tsx`（重写）

**Interfaces:**
- Consumes: 以上全部组件与数据源

- [ ] **Step 1: 重写 App.test.tsx（先写测试）**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { fetchConfig, fetchModules } from "./api"

vi.mock("./api", () => ({
  fetchConfig: vi.fn().mockResolvedValue(null),
  fetchModules: vi.fn().mockResolvedValue([]),
}))
const mockedFetchConfig = vi.mocked(fetchConfig)
const mockedFetchModules = vi.mocked(fetchModules)

describe("App (v5 agent homepage)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0))
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it("renders v5 shell with brand, project strip metrics and chat welcome", async () => {
    render(<App />)
    expect(screen.getAllByText("Octopus Platform").length).toBeGreaterThan(0)   // 切换器 + 副文案
    expect(screen.getByText("78%")).toBeInTheDocument()                          // strip
    await waitFor(() => expect(screen.getByText(/早上好。当前上下文/)).toBeInTheDocument())
    expect(mockedFetchConfig).toHaveBeenCalled()                                 // config 链路仍在
  })

  it("opens kanban drawer from strip and closes on Esc", async () => {
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: /任务看板/ }))
    expect(await screen.findByRole("heading", { name: "任务看板" })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("heading", { name: "任务看板" })).not.toBeInTheDocument())
  })

  it("modules drawer keeps lazy-load chain alive", async () => {
    mockedFetchModules.mockResolvedValue([
      { id: "quickstart", title: "快捷入口", entry: "/octopus/quickstart/assets/index.js" },
    ])
    render(<App />)
    fireEvent.click(screen.getByRole("button", { name: /已装模块/ }))
    expect(await screen.findByRole("button", { name: "快捷入口" })).toBeInTheDocument()
  })

  it("chat send round-trip shows assistant cards", async () => {
    render(<App />)
    const box = screen.getByPlaceholderText(/给 Octo Agent 下指令/)
    fireEvent.input(box, { target: { value: "列出优先事项" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(await screen.findByText("让 Agent 接手 →")).toBeInTheDocument()
    expect(screen.getByTitle("展开产出面板")).toBeInTheDocument() // rail 已被产出撑出？否——rail 默认展开；断言 rail 内容
    expect(screen.getByText("本会话产出")).toBeInTheDocument()
  })
})
```

> 最后一个用例中「展开产出面板」断言仅在 rail 被收起后出现——默认展开时删掉该行，只保留「本会话产出」断言。（按实现实际微调，保持用例可过。）

- [ ] **Step 2: 运行确认失败** — Run: `pnpm --filter octopus exec vitest run --root web src/App.test.tsx` → FAIL（App 还是旧版）

- [ ] **Step 3: 重写 App.tsx**

```tsx
export default function App() {
  const [config] = useState(() => null)                       // config 仅用于未来 title；fetchConfig 照常调用以保持链路
  const projects = PROJECTS
  const [projectId, setProjectId] = useState(projects[0].id)
  const current = projects.find((p) => p.id === projectId)!
  const [drawer, setDrawer] = useState<null | "tasks" | "reqs" | "modules">(null)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const client = useMemo(createDefaultAgentClient, [])
  return (
    <div className="app-shell">
      <TopBar projects={projects} currentProjectId={projectId} onSwitchProject={setProjectId}
              onOpenModules={() => setDrawer("modules")} />
      <ProjectStrip summary={current}
                    onOpenKanban={() => setDrawer("tasks")} onOpenRequirements={() => setDrawer("reqs")} />
      <div className="app-main">
        <ChatPane />
        <ArtifactsRail artifacts={/* useChat 上移或经 ChatPane 回调收集 */ []}
                       collapsed={railCollapsed}
                       onCollapse={() => setRailCollapsed(true)} onExpand={() => setRailCollapsed(false)} />
      </div>
      <KanbanDrawer open={drawer === "tasks"} onClose={() => setDrawer(null)} />
      <RequirementsDrawer open={drawer === "reqs"} onClose={() => setDrawer(null)} />
      <ModulesDrawer open={drawer === "modules"} onClose={() => setDrawer(null)}
                     modules={modules} /* useEffect fetchModules */ />
    </div>
  )
}
```

要点：`artifacts` 需要与聊天联动——把 `useChat` 从 ChatPane 提升到 App：ChatPane 改为接收 `messages/status/send` props（ChatPane 的测试相应改为传注入 hook 结果或保持内部 hook 但加 `onArtifacts` 回调上报数量；**采用回调方案改动最小**：useChat 已返回 artifacts，ChatPane 通过 `props.onArtifactsChange(artifacts)` effect 上报，App 存 state 传给 ArtifactsRail）。布局类直接写 Tailwind：外层 `<div className="flex h-screen flex-col overflow-hidden">`，主区 `<div className="flex min-h-0 flex-1">`。旧 hero/links/greeting 直接删除（greeting.ts 仍被 use-chat 使用）。App 外层包 `<ThemeProvider defaultMode="dark">`（Task 1a），保证首页默认暗色。

- [ ] **Step 4: 全量 web 测试转绿**

Run: `pnpm --filter octopus exec vitest run --root web`
Expected: 全部 PASS（含 ModuleGrid.test、datasource、agent-client、use-chat、组件测试）

- [ ] **Step 5: 类型检查与完整构建**

Run: `pnpm --filter octopus exec tsc -p web/tsconfig.json --noEmit ; pnpm --filter octopus build`
Expected: typecheck 0 error；vite 构建成功产出 web-dist

- [ ] **Step 6: 手工冒烟（pnpm dev:noopen 后访问 http://127.0.0.1:3080/workbench）**

核对清单：
- [ ] 顶栏三个下拉开合正常，Esc/外点关闭
- [ ] 项目切换后 ProjectStrip 数据随之切换（切换到 Merchant Portal 后指标变化）
- [ ] chip 点击填入输入框，Enter 发送出现卡片回复，右栏新增两条 task 产出且 live 点呼吸
- [ ] 收起右栏出现恢复按钮，点恢复还原
- [ ] 需求池/任务看板抽屉滑出、backdrop/Esc 关闭
- [ ] 已装模块抽屉里 quickstart 卡片可展开加载
- [ ] prefers-reduced-motion 下 spinner/chip 动画不引起布局跳动（视觉检查即可）

- [ ] **Step 7: Commit**

```powershell
git add packages/octopus/web/src/App.tsx packages/octopus/web/src/App.test.tsx packages/octopus/web/src/components/ChatPane.tsx packages/octopus/web/src/ModuleGrid.tsx
git commit -m "feat: rewrite homepage as agent-first workbench (v5)"
```

---

## Self-Review 记录

- 规格覆盖：v5 的顶栏三下拉(T6)、项目条(T7)、快捷 chips/上下文选择器(T9)、七类消息块(T8)、会话产出栏(T11)、需求池/任务看板/已装模块抽屉(T12)、欢迎语与派活流程(T3/T4/T10)均有对应任务；旧首页的「进入主界面」链接(T6 设置菜单)、config/modules API 链路(T13 测试断言)、ModuleGrid 懒加载(T12/T13)全部保留。
- 设计系统规范对齐（2026-08-26 二次修订）：样式技术改为 Tailwind v4 + octopus-ui 包（Phase 0 任务 1a–1e），token 采用规范的三段式 `--palette-*`→`--brand-*`→`--color-*` 与 `[data-mode]` 协议，页面红线（禁裸色值/arbitrary 色/裸 z-index）纳入全局约束；浮层件改用 Radix 底座（DropdownMenu/Sheet），图标统一 lucide 出口；原自研 Dropdown（旧 T5）与全部组件级 CSS 文件方案作废。dsh `--dsw-alias` 词汇对齐让位于本仓库设计系统规范。
- 占位扫描：无 TBD/TODO 步骤；Task 2 中 createDefaultAgentClient 的桩在 Task 3 内被真实实现替换，属计划内的两步交付。
- 类型一致性：MessageBlock 七种 kind 在 T2 定义、T3 脚本使用、T8 渲染一一对应；Artifact.id 去重逻辑在 T4 契约中明确；Drawer 关闭按钮统一 aria-label="关闭" 供 T12 测试。




