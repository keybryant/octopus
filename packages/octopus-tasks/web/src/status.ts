import type { BadgeTone } from "octopus-ui"
import type { TaskStatus } from "./types"

export interface ColumnSpec {
  key: TaskStatus
  label: string
  dotColor: string
}

/** 看板列配置（顺序即展示顺序） */
export const TASK_COLUMNS: ColumnSpec[] = [
  { key: "todo", label: "待处理", dotColor: "#5C6577" },
  { key: "doing", label: "进行中", dotColor: "#60A5FA" },
  { key: "review", label: "评审中", dotColor: "#A78BFA" },
  { key: "done", label: "已完成", dotColor: "#34D399" },
]

export const STATUS_META: Record<TaskStatus, { label: string; tone: BadgeTone }> = {
  todo: { label: "待处理", tone: "neutral" },
  doing: { label: "进行中", tone: "info" },
  review: { label: "评审中", tone: "warn" },
  done: { label: "已完成", tone: "success" },
}
