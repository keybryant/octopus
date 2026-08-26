import type { BadgeTone } from "octopus-ui"
import type { RequirementStatus } from "./types"

/** 状态展示元数据（与后端 src/types.ts 的迁移表保持一致） */
export const STATUS_META: Record<RequirementStatus, { label: string; tone: BadgeTone }> = {
  backlog: { label: "待排期", tone: "neutral" },
  planned: { label: "已排期", tone: "info" },
  "in-progress": { label: "开发中", tone: "info" },
  review: { label: "评审中", tone: "warn" },
  done: { label: "已完成", tone: "success" },
}

export const STATUS_ORDER: RequirementStatus[] = ["backlog", "planned", "in-progress", "review", "done"]

export const TRANSITIONS: Record<RequirementStatus, readonly RequirementStatus[]> = {
  backlog: ["planned"],
  planned: ["backlog", "in-progress"],
  "in-progress": ["planned", "review"],
  review: ["in-progress", "done"],
  done: [],
}
