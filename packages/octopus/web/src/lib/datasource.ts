import type {
  Artifact,
  ProjectSummary,
} from "./types"

export type { AgentClient } from "./types"

export { createDefaultAgentClient } from "./agent-client"

export const PROJECTS: ProjectSummary[] = [
  {
    id: "octopus-platform",
    name: "Octopus Platform",
    shortName: "OP",
    description: "企业级一站式开发协作平台 · 目标 Q4 上线公测",
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

export const QUICK_PROMPTS: string[] = [
  "📋 列出今日待办",
  "⚡ 把 REQ-124 拆成子任务",
  "📊 生成本周迭代周报",
  "🔍 审查最近的 PR",
  "🗓️ 规划下个迭代",
]
