import { useState } from "react"
import { Badge, Button, ProgressBar, Sheet } from "octopus-ui"
import { Plus } from "octopus-ui"
import type { BadgeTone as UiBadgeTone } from "octopus-ui"
import type { KanbanColumn, KanbanTask, NewTaskInput } from "../lib/types"
import { OctoLogo } from "./OctoLogo"
import { NewTaskModal } from "./NewTaskModal"

const toneMap: Record<string, UiBadgeTone> = {
  green: "success",
  blue: "info",
  gray: "neutral",
  orange: "warn",
}

const priorityToneMap: Record<NewTaskInput["priority"], UiBadgeTone> = {
  P0: "warn",
  P1: "info",
  P2: "neutral",
}

/** ui 语义色 → 领域徽章色（写回数据层时收窄） */
function toDomainTone(t: UiBadgeTone): "green" | "blue" | "gray" | "orange" {
  return t === "success" ? "green" : t === "info" ? "blue" : t === "danger" ? "orange" : "gray"
}

export interface KanbanDrawerProps {
  open: boolean
  onClose: () => void
  columns: KanbanColumn[]
  onCreateTask: (task: KanbanTask) => void
}

export function KanbanDrawer({ open, onClose, columns, onCreateTask }: KanbanDrawerProps) {
  const [creating, setCreating] = useState(false)

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="任务看板"
      subtitle="Octopus Platform · 迭代 4.2"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-text-faint">拖拽暂不支持，使用按钮新建</span>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          新建任务
        </Button>
      </div>

      <div className="flex min-w-max gap-4">
        {columns.map((col) => (
          <div key={col.key} className="w-60 shrink-0">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: col.dotColor }} />
              <span className="text-xs font-medium text-muted-foreground">{col.label}</span>
              <span className="font-mono text-[11px] text-text-faint">{col.tasks.length}</span>
            </div>
            <div className="space-y-2.5">
              {col.tasks.map((t) => (
                <div
                  key={t.id}
                  className={`cursor-pointer rounded-xl border border-border bg-surface p-3.5 transition-colors duration-fast hover:bg-surface-hover ${
                    t.dimmed ? "opacity-75" : ""
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[10.5px] text-text-faint">{t.id}</span>
                    {t.badge && <Badge tone={toneMap[t.badge.tone]}>{t.badge.label}</Badge>}
                    {t.agentRun && <OctoLogo className="ml-auto h-3.5 w-3.5 text-accent" />}
                  </div>
                  <div className={`text-[13px] font-medium leading-snug ${t.dimmed ? "line-through text-muted-foreground" : ""}`}>
                    {t.title}
                  </div>
                  {(t.progressPct !== undefined || t.progressLabel || t.diffStat || t.dueLabel || t.assignee) && (
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      {t.progressPct !== undefined && <ProgressBar value={t.progressPct} className="flex-1" />}
                      {t.progressLabel && <span className="font-mono text-[10.5px] text-accent">{t.progressLabel}</span>}
                      {t.diffStat && <span className="font-mono text-[10.5px] text-info">{t.diffStat}</span>}
                      {t.dueLabel && <span className="text-[11px] text-text-faint">{t.dueLabel}</span>}
                      {t.assignee && (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[9px] text-muted-foreground">
                          {t.assignee.slice(0, 2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {col.tasks.length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-[11px] text-text-faint">
                  暂无任务
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <NewTaskModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(input) => {
          const num = Math.max(
            ...columns.flatMap((c) => c.tasks.map((t) => Number(t.id.replace("TASK-", "")) || 0)),
            2800,
          ) + 1
          const task: KanbanTask = {
            id: `TASK-${num}`,
            title: input.title,
            column: "todo",
            badge: { label: input.priority, tone: toDomainTone(priorityToneMap[input.priority]) },
            assignee: input.assignee,
          }
          onCreateTask(task)
          setCreating(false)
        }}
      />
    </Sheet>
  )
}
