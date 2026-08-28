import type { TaskDraft } from "./types.js"

export interface DecomposeContext {
  title: string
  description?: string
}

/**
 * mock AI 拆解草稿生成器：确定性规则，标题基于需求标题模板化。
 * 真实 LLM 接入时仅替换本函数实现（契约：输入需求上下文，输出 TaskDraft[]）。
 */
export function generateTaskDrafts(input: DecomposeContext): TaskDraft[] {
  const title = input.title.trim()
  const description = input.description?.trim() ?? ""
  return [
    {
      title: `实现${title} · 核心逻辑`,
      description,
    },
    {
      title: `${title} · 联调与测试`,
    },
    {
      title: `${title} · 验收与上线准备`,
    },
  ]
}
