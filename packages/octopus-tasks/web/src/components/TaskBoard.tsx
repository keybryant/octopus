import { useState, type Dispatch, type SetStateAction } from "react"
import { Badge, Spinner } from "octopus-ui"
import { TASK_COLUMNS, type ColumnSpec } from "../status"
import type { TaskRecord, TaskStatus } from "../types"

const priorityTone: Record<TaskRecord["priority"], "warn" | "info" | "neutral"> = {
  P0: "warn",
  P1: "info",
  P2: "neutral",
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
        <span className="font-mono text-[11px] text-text-faint">{tasks.length}</span>
      </div>
      <div
        className={`space-y-2.5 rounded-xl p-1 transition-colors ${
          isOver ? "bg-surface-hover ring-1 ring-inset ring-border-strong" : ""
        }`}
      >
        {tasks.map((t) => (
          <div
            key={t.id}
            draggable={!busyIds.has(t.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", t.id)
              e.dataTransfer.effectAllowed = "move"
            }}
            className={`cursor-grab rounded-xl border border-border bg-surface p-3.5 transition-opacity active:cursor-grabbing ${
              t.status === "done" ? "opacity-75" : ""
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[10.5px] text-text-faint">{t.id}</span>
              <Badge tone={priorityTone[t.priority]}>{t.priority}</Badge>
              {busyIds.has(t.id) && <Spinner className="ml-auto h-3 w-3" />}
            </div>
            <div className={`text-[13px] font-medium leading-snug ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
              {t.title}
            </div>
            {t.assignee && (
              <div className="mt-2.5 flex items-center justify-end">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[9px] text-muted-foreground">
                  {t.assignee.slice(0, 2)}
                </span>
              </div>
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

/** 任务看板：4 列 + 原生 HTML5 拖拽（跨列迁态，列内按创建序） */
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
