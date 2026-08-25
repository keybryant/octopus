import { Badge, ProgressBar, Sheet } from "octopus-ui"
import type { BadgeTone as UiBadgeTone } from "octopus-ui"
import { REQUIREMENTS } from "../lib/datasource"

const toneMap: Record<string, UiBadgeTone> = {
  green: "success",
  blue: "info",
  gray: "neutral",
  orange: "warn",
}

export function RequirementsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="需求池"
      subtitle="Octopus Platform · 24 个活跃需求"
    >
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-faint">
              <th className="px-4 py-3 font-medium">编号</th>
              <th className="px-4 py-3 font-medium">标题</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">负责人</th>
              <th className="px-4 py-3 font-medium">进度</th>
            </tr>
          </thead>
          <tbody>
            {REQUIREMENTS.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer divide-x divide-transparent border-b border-border/60 transition-colors last:border-0 hover:bg-surface"
              >
                <td className="px-4 py-3.5 font-mono text-xs text-text-faint">{r.id}</td>
                <td className="px-4 py-3.5 font-medium">{r.title}</td>
                <td className="px-4 py-3.5">
                  <Badge tone={toneMap[r.statusBadge.tone]}>{r.statusBadge.label}</Badge>
                </td>
                <td className={`px-4 py-3.5 ${r.owner ? "" : "text-text-faint"}`}>{r.owner ?? "未分配"}</td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <ProgressBar value={r.progressPct} className="w-20" />
                    <span className="font-mono text-[11px] text-muted-foreground">{r.progressPct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sheet>
  )
}
