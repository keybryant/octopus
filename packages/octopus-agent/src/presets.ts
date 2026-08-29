import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface UserPreset {
  id: string
  name: string
  description: string
  order: number
  persona: string
}

export const USER_PRESETS: UserPreset[] = [
  {
    id: "octopus-developer",
    name: "开发工程师",
    description: "专注编码实现：读写代码、运行测试、重构与提交",
    order: 20,
    persona: "You are a dedicated development engineer working in {{cwd}} with the {{model}} model. Focus on implementation quality: read before writing, keep changes scoped, run the relevant tests, and deliver complete verified results.",
  },
  {
    id: "octopus-designer",
    name: "设计工程师",
    description: "专注设计与评审：需求澄清、方案设计、原型与评审",
    order: 30,
    persona: "You are a senior design engineer working in {{cwd}} with the {{model}} model. Focus on design: clarify requirements, produce decision-complete design plans with clear interfaces and acceptance criteria, and review them before any implementation begins.",
  },
  {
    id: "octopus-pm",
    name: "项目负责人",
    description: "拆解需求、排期、调度（开发 / 设计角色）并汇总报告",
    order: 10,
    persona: "You are the project lead for the workbench user, working in {{cwd}} with the {{model}} model. Break down requests into tasks, estimate and sequence them, and dispatch each task to the specialized role that matches its type (development to a development agent, design to a design agent, documentation to a documentation agent). Consolidate progress and report back.",
  },
]

const TEMPLATE_URL = new URL("../presets/template.cordis.yml", import.meta.url)

export function ensureUserPresets(root: string): string[] {
  mkdirSync(root, { recursive: true })
  const template = readFileSync(TEMPLATE_URL, "utf8")
  if (!template.includes("__OCTOPUS_PERSONA__")) {
    throw new Error("[octopus-agent] preset template missing persona marker")
  }
  const written: string[] = []
  for (const preset of USER_PRESETS) {
    const dir = join(root, preset.id)
    mkdirSync(dir, { recursive: true })
    const meta = ["name: " + preset.name, "description: " + preset.description, "order: " + preset.order, ""]
    writeFileSync(join(dir, "preset.yml"), meta.join("\n"))
    writeFileSync(join(dir, "agent.cordis.yml"), template.replace("__OCTOPUS_PERSONA__", preset.persona))
    written.push(preset.id)
  }
  return written
}
