import { Button } from "octopus-ui"
import { Blocks, Columns3 } from "octopus-ui"
import type { ProjectSummary } from "../lib/types"

export interface ProjectStripProps {
  summary: ProjectSummary
  onOpenKanban: () => void
  onOpenModules: () => void
}

interface MetricProps {
  value: string | number
  suffix?: string
  label: string
  /** 逾期等告警色 */
  warn?: boolean
}

function Metric({ value, suffix, label, warn }: MetricProps) {
  return (
    <div>
      <div className="font-mono text-[15px] leading-tight">
        <span className={warn ? "text-warn" : undefined}>{value}</span>
        {suffix && <span className="text-xs text-text-faint">{suffix}</span>}
      </div>
      <div className="mt-0.5 text-[10.5px] text-text-faint">{label}</div>
    </div>
  )
}

export function ProjectStrip({ summary, onOpenKanban, onOpenModules }: ProjectStripProps) {
  return (
    <section className="flex h-14 shrink-0 items-center gap-6 border-b border-border bg-background px-6">
      <Metric value={summary.weeklyDone} suffix={`/${summary.weeklyTotal}`} label="本周任务" />
      <Metric value={summary.activeRequirements} label="活跃需求" />
      <Metric value={summary.overdue} label="逾期" warn={summary.overdue > 0} />
      <Metric value={summary.dueDate} label="迭代截止" />

      <span className="flex-1" />

      <Button variant="ghost" size="sm" onClick={onOpenModules}>
        <Blocks className="h-3.5 w-3.5" />
        已装模块
      </Button>
      <Button variant="ghost" size="sm" onClick={onOpenKanban}>
        <Columns3 className="h-3.5 w-3.5" />
        任务看板
      </Button>
    </section>
  )
}
