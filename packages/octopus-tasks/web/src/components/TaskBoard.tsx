import { useState, type Dispatch, type SetStateAction } from "react"
import {
  ChevronDown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
} from "octopus-ui"
import { TASK_COLUMNS, type ColumnSpec } from "../status"
import type { TaskRecord, TaskStatus } from "../types"

/** 状态单向迁移表：todo → doing → review → done；done 为终态无出口 */
const NEXT_BY_STATUS: Record<Exclude<TaskStatus, "done">, TaskStatus[]> = {
  todo: ["doing"],
  doing: ["review"],
  review: ["done"],
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "待处理",
  doing: "进行中",
  review: "评审中",
  done: "已完成",
}

export interface TaskBoardProps {
  tasks: TaskRecord[]
  busyIds: ReadonlySet<string>
  onMove: (id: string, status: TaskStatus) => Promise<void> | void
}

function ColumnBody({ column, tasks, busyIds, onMove, dragOver, setDragOver }: {
  column: ColumnSpec
  tasks: TaskRecord[]
  busyIds: ReadonlySet<string>
  onMove: (id: string, status: TaskStatus) => Promise<void> | void
  dragOver: TaskStatus | null
  setDragOver: Dispatch<SetStateAction<TaskStatus | null>>
}) {
  const isOver = dragOver === column.key
  const dimColumn = column.key === "done"
  return (
    <div
      className="w-60 shrink-0"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(column.key)
      }}
      onDragLeave={() => setDragOver((s) => (s === column.key ? null : s))}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(null)
        const id = e.dataTransfer.getData("text/plain")
        if (id) void onMove(id, column.key)
      }}
      role="group"
      aria-label={column.label}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: column.dotColor }} />
        <span className="text-xs font-medium text-muted-foreground">{column.label}</span>
        <span className="mono text-[11px] text-text-faint">{tasks.length}</span>
      </div>
      <div className={`space-y-2.5 ${dimColumn ? "opacity-75" : ""}`}>
        {tasks.map((t) => (
          <div
            key={t.id}
            draggable={!busyIds.has(t.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", t.id)
              e.dataTransfer.effectAllowed = "move"
            }}
            className={`cursor-pointer rounded-xl border border-border bg-surface p-3.5 transition-colors duration-fast hover:bg-surface-hover ${
              t.status === "doing" ? "border-l-2 border-l-accent" : ""
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="mono text-[10.5px] text-text-faint">{t.id}</span>
              {t.agentSessionId && (
                <span
                  aria-label="agent session"
                  title={`任务会话 ${t.agentSessionId}`}
                  className="rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground"
                >
                  agent
                </span>
              )}
              {busyIds.has(t.id) && <Spinner className="ml-auto h-3 w-3" />}
              {t.status !== "done" && !busyIds.has(t.id) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`切换状态 ${t.id}`}
                      className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-surface-hover hover:text-foreground"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {NEXT_BY_STATUS[t.status].map((target) => (
                      <DropdownMenuItem key={target} onClick={() => void onMove(t.id, target)}>
                        {STATUS_LABEL[target]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className={`text-[13px] font-medium leading-snug ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
              {t.title}
            </div>
            {t.agentSummary && (
              <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{t.agentSummary}</div>
            )}
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-[11px] text-text-faint">
            暂无任务
          </div>
        )}
      </div>
    </div>
  )
}

/** 任务看板：4 列 + 原生 HTML5 拖拽（跨列迁态，列内按创建序），卡片内状态下拉为无拖拽环境兜底 */
export function TaskBoard({ tasks, busyIds, onMove }: TaskBoardProps) {
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null)

  return (
    <div className="flex min-w-max gap-4">
      {TASK_COLUMNS.map((column) => (
        <ColumnBody
          key={column.key}
          column={column}
          tasks={tasks.filter((t) => t.status === column.key)}
          busyIds={busyIds}
          onMove={onMove}
          dragOver={dragOver}
          setDragOver={setDragOver}
        />
      ))}
    </div>
  )
}
