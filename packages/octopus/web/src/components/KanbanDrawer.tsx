import { Badge, ProgressBar, Sheet } from "octopus-ui"
import type { BadgeTone as UiBadgeTone } from "octopus-ui"
import { KANBAN_COLUMNS } from "../lib/datasource"
import { OctoLogo } from "./OctoLogo"

const toneMap: Record<string, UiBadgeTone> = {
  green: "success",
  blue: "info",
  gray: "neutral",
  orange: "warn",
}

export function KanbanDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="任务看板"
      subtitle="Octopus Platform · 迭代 4.2"
    >
      <div className="flex min-w-max gap-4">
        {KANBAN_COLUMNS.map((col) => (
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
                  {(t.progressPct !== undefined || t.progressLabel || t.diffStat || t.dueLabel) && (
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      {t.progressPct !== undefined && <ProgressBar value={t.progressPct} className="flex-1" />}
                      {t.progressLabel && <span className="font-mono text-[10.5px] text-accent">{t.progressLabel}</span>}
                      {t.diffStat && <span className="font-mono text-[10.5px] text-info">{t.diffStat}</span>}
                      {t.dueLabel && <span className="text-[11px] text-text-faint">{t.dueLabel}</span>}
                      {t.assignee && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-hover text-[9px] text-muted-foreground">
                          {t.assignee.slice(0, 2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  )
}
