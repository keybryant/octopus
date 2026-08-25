import type { AgentClient, AgentReply, Artifact, MessageBlock } from "./types"

const PRIORITY_SCRIPT: MessageBlock[] = [
  {
    kind: "paragraph",
    segs: [{ text: "结合截止时间和阻塞关系，今天建议按这个顺序处理：" }],
  },
  {
    kind: "cards",
    cards: [
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
    ],
  },
]

const DELEGATION_SCRIPT: { blocks: MessageBlock[]; artifacts: Artifact[] } = {
  blocks: [
    {
      kind: "paragraph",
      segs: [
        { text: "收到。我建了一条自动化流水线来接管 " },
        { text: "TASK-2850", accent: "green" },
        { text: "：" },
      ],
    },
    {
      kind: "steps",
      items: [
        { state: "done", text: "升级依赖并修复 Breaking Changes（已定位 4 处）" },
        { state: "active", text: "运行全量回归测试（预计 25 分钟）…" },
        { state: "pending", text: "输出报告并发给你 & 王倩" },
      ],
    },
    { kind: "actions", actions: ["暂停执行", "查看执行日志"] },
  ],
  artifacts: [
    {
      id: "art-pipeline-2857",
      kind: "task",
      title: "TASK-2857 自动化流水线",
      subtitle: "升级依赖 + 回归测试 + 报告通知",
      live: true,
    },
  ],
}

const ACK_SCRIPT: MessageBlock[] = [
  {
    kind: "paragraph",
    segs: [
      { text: "收到。当前上下文是 " },
      { text: "Octopus Platform · 迭代 4.2", accent: "green" },
      { text: "，可以让我列出待办、拆解需求或生成周报。" },
    ],
  },
]

function pickScript(input: string): AgentReply {
  if (/待办|优先|事项/.test(input)) return { blocks: PRIORITY_SCRIPT }
  if (/接手|自动|跑/.test(input)) return { blocks: DELEGATION_SCRIPT.blocks, artifacts: DELEGATION_SCRIPT.artifacts }
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
