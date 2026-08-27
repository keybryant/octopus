import type { Priority, TaskDraft } from "./types.js"

export interface DecomposeContext {
  title: string
  description?: string
  priority?: Priority
}

/**
 * mock AI 拆解草稿生成器：确定性规则，标题基于需求标题模板化。
 * 真实 LLM 接入时仅替换本函数实现（契约：输入需求上下文，输出 TaskDraft[]）。
 */
export function generateTaskDrafts(input: DecomposeContext): TaskDraft[] {
  const title = input.title.trim()
  const priority = input.priority ?? "P1"
  const description = input.description?.trim() ?? ""
  const drafts: TaskDraft[] = [
    {
      title: `实现${title} · 核心逻辑`,
      priority,
      description,
    },
    {
      title: `${title} · 联调与测试`,
      priority,
    },
    {
      title: `${title} · 验收与上线准备`,
      priority: "P2",
    },
  ]
  if (priority === "P0") {
    drafts.unshift({ title: `排期与拆解 ${title}`, priority: "P0" })
  }
  return drafts
}
