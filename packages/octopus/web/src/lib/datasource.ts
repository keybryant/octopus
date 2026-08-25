import type {
  AgentClient,
  Artifact,
  KanbanColumn,
  ProjectSummary,
  Requirement,
} from "./types"

export type { AgentClient } from "./types"

export const PROJECTS: ProjectSummary[] = [
  {
    id: "octopus-platform",
    name: "Octopus Platform",
    shortName: "OP",
    description: "企业级一站式开发协作平台 · 目标 Q4 上线公测",
    iteration: "迭代 4.2 · 第 2 周",
    dueDate: "10-31",
    progressPct: 78,
    weeklyDone: 28,
    weeklyTotal: 40,
    activeRequirements: 24,
    overdue: 3,
    members: [
      { initials: "ZS" },
      { initials: "LW" },
      { initials: "WQ" },
      { initials: "LY" },
      { initials: "CC" },
      { initials: "ZP" },
      { initials: "SM" },
      { initials: "ZT" },
    ],
  },
  {
    id: "merchant-portal",
    name: "Merchant Portal",
    shortName: "MP",
    description: "商户门户 · 多端一体化经营工具",
    iteration: "迭代 2.8 · 第 3 周",
    dueDate: "11-14",
    progressPct: 46,
    weeklyDone: 12,
    weeklyTotal: 30,
    activeRequirements: 15,
    overdue: 1,
    members: [
      { initials: "LW" },
      { initials: "ZP" },
      { initials: "CC" },
      { initials: "ZS" },
    ],
  },
  {
    id: "data-core",
    name: "Data Core",
    shortName: "DC",
    description: "数据中台 · 指标与报表统一服务",
    iteration: "迭代 1.5 · 第 1 周",
    dueDate: "12-05",
    progressPct: 21,
    weeklyDone: 5,
    weeklyTotal: 25,
    activeRequirements: 9,
    overdue: 0,
    members: [{ initials: "LY" }, { initials: "SM" }, { initials: "ZT" }],
  },
]

export function currentProject(): ProjectSummary {
  return PROJECTS[0]
}

export interface PriorityCard {
  badge?: { label: string; tone: "green" | "blue" | "gray" | "orange" }
  title: string
  hint: string
  actionLabel?: string
}

export const PRIORITY_CARDS: PriorityCard[] = [
  {
    badge: { label: "逾期", tone: "orange" },
    title: "TASK-2850 · React 19 升级兼容性验证",
    hint: "已逾期 2 天 · 阻塞 REQ-118 联调 · 建议今天集中解决",
    actionLabel: "让 Agent 接手 →",
  },
  {
    badge: { label: "今天 18:00", tone: "blue" },
    title: "TASK-2841 · 认证模块 OAuth 2.0 重构",
    hint: "进度 65% · 剩余工作约 3 小时 · 张三负责",
    actionLabel: "查看详情",
  },
  {
    badge: { label: "本周内", tone: "gray" },
    title: "REQ-121 · Agent 任务编排可视化评审",
    hint: "周四评审会前需要补充流程图初稿",
  },
]

export const INITIAL_ARTIFACTS: Artifact[] = [
  {
    id: "art-task-2850",
    kind: "task",
    title: "TASK-2850 转 Agent 执行",
    subtitle: "React 19 兼容性验证 · 回归测试中",
    live: true,
  },
  {
    id: "art-pipeline-2854",
    kind: "task",
    title: "TASK-2854 自动化流水线",
    subtitle: "升级依赖 + 回归测试 + 报告通知",
  },
  {
    id: "art-doc-rush-plan",
    kind: "doc",
    title: "赶工方案草案.md",
    subtitle: "针对 REQ-118 延期风险 · 3 分钟前",
  },
  {
    id: "art-commit-a3f",
    kind: "commit",
    title: "fix: token cache TTL",
    subtitle: "auth/optimize 分支 · 待 CI 通过",
  },
]

const KANBAN_TASKS = [
  // todo
  { id: "TASK-2852", title: "导出报表支持 CSV 格式", column: "todo", badge: { label: "P1", tone: "orange" }, dueLabel: "10-29", assignee: "LW" },
  { id: "TASK-2853", title: "审计日志查询接口分页优化", column: "todo", dueLabel: "10-30", assignee: "WQ" },
  // doing
  { id: "TASK-2841", title: "认证模块 OAuth 2.0 重构", column: "doing", badge: { label: "进行中", tone: "blue" }, progressPct: 65, assignee: "ZS" },
  { id: "TASK-2850", title: "React 19 升级兼容性验证", column: "doing", badge: { label: "Agent 执行中", tone: "green" }, progressLabel: "回归测试中", agentRun: true, assignee: "OCTO" },
  { id: "TASK-2856", title: "权限缓存失效策略联调修复", column: "doing", badge: { label: "已逾期", tone: "orange" }, progressPct: 20, assignee: "WQ" },
] as const

const KANBAN_REVIEW = [
  { id: "TASK-2847", title: "权限缓存失效策略 PR #882", column: "review", diffStat: "+214 −38", assignee: "ZS" },
  { id: "TASK-2848", title: "消息中心聚合拉取策略", column: "review", diffStat: "+86 −12", assignee: "LY" },
] as const

const KANBAN_DONE = [
  { id: "TASK-2838", title: "数据库索引重建与慢查询治理", column: "done", dueLabel: "昨天", assignee: "LW" },
  { id: "TASK-2836", title: "对象存储迁移至新 Bucket", column: "done", dueLabel: "前天", assignee: "ZS" },
  { id: "TASK-2833", title: "网关访问日志采样率调整", column: "done", dueLabel: "本周", assignee: "CC" },
] as const

export const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    key: "todo",
    label: "待处理",
    dotColor: "#5C6577",
    tasks: KANBAN_TASKS.filter((t) => t.column === "todo").map((t) => ({ ...t })),
  },
  {
    key: "doing",
    label: "进行中",
    dotColor: "#60A5FA",
    tasks: KANBAN_TASKS.filter((t) => t.column === "doing").map((t) => ({ ...t })),
  },
  {
    key: "review",
    label: "评审中",
    dotColor: "#A78BFA",
    tasks: KANBAN_REVIEW.map((t) => ({ ...t })),
  },
  {
    key: "done",
    label: "已完成",
    dotColor: "#34D399",
    tasks: KANBAN_DONE.map((t) => ({ ...t, dimmed: true })),
  },
]

export const REQUIREMENTS: Requirement[] = [
  { id: "REQ-118", title: "多租户权限体系升级", statusBadge: { label: "开发中", tone: "blue" }, owner: "张三", progressPct: 48 },
  { id: "REQ-121", title: "Agent 任务编排可视化", statusBadge: { label: "评审中", tone: "gray" }, owner: "李雯", progressPct: 15 },
  { id: "REQ-124", title: "CI 流水线缓存加速", statusBadge: { label: "待排期", tone: "orange" }, owner: null, progressPct: 0 },
  { id: "REQ-115", title: "消息通知中心聚合", statusBadge: { label: "已完成", tone: "green" }, owner: "王倩", progressPct: 100 },
]

export const QUICK_PROMPTS: string[] = [
  "📋 列出今日待办",
  "⚡ 把 REQ-124 拆成子任务",
  "📊 生成本周迭代周报",
  "🔍 审查最近的 PR",
  "🗓️ 规划下个迭代",
]

/** Phase 1 内置 mock 实现；真实后端接入时替换此处 */
export function createDefaultAgentClient(): AgentClient {
  throw new Error("implemented in Task 3")
}
