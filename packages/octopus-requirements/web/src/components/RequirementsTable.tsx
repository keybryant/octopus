import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "octopus-ui"
import { Layers, Pencil, Trash2 } from "octopus-ui"
import { STATUS_META, TRANSITIONS } from "../status"
import type { Priority, RequirementRecord, RequirementStatus } from "../types"

const priorityTone: Record<Priority, "warn" | "info" | "neutral"> = {
  P0: "warn",
  P1: "info",
  P2: "neutral",
}

export interface RequirementsTableProps {
  requirements: RequirementRecord[]
  onStatusChange: (id: string, status: RequirementStatus) => Promise<void> | void
  onDelete: (id: string) => Promise<void> | void
  onEdit: (record: RequirementRecord) => void
  onDecompose: (record: RequirementRecord) => void
  busyIds: ReadonlySet<string>
}

export function RequirementsTable({ requirements, onStatusChange, onDelete, onEdit, onDecompose, busyIds }: RequirementsTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-faint">
            <th className="px-4 py-3 font-medium">编号</th>
            <th className="px-4 py-3 font-medium">标题</th>
            <th className="px-4 py-3 font-medium">优先级</th>
            <th className="px-4 py-3 font-medium">状态</th>
            <th className="px-4 py-3 font-medium">创建时间</th>
            <th className="px-4 py-3 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {requirements.map((r) => {
            const meta = STATUS_META[r.status]
            const targets = TRANSITIONS[r.status]
            const busy = busyIds.has(r.id)
            return (
              <tr key={r.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface">
                <td className="px-4 py-3.5 font-mono text-xs text-text-faint">{r.id}</td>
                <td className="max-w-[320px] px-4 py-3.5">
                  <div className="truncate font-medium">{r.title}</div>
                  {r.description && (
                    <div className="mt-0.5 truncate text-[11.5px] text-text-faint">{r.description}</div>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <Badge tone={priorityTone[r.priority]}>{r.priority}</Badge>
                </td>
                <td className="px-4 py-3.5">
                  {targets.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger disabled={busy} className="cursor-pointer">
                        <Badge tone={meta.tone} className="cursor-pointer">
                          {meta.label}
                        </Badge>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {targets.map((t) => (
                          <DropdownMenuItem
                            key={t}
                            onClick={() => void onStatusChange(r.id, t)}
                          >
                            {STATUS_META[t].label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  )}
                </td>
                <td className="px-4 py-3.5 font-mono text-[11px] text-muted-foreground">
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3.5 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`拆解任务 ${r.id}`}
                    title={`从 ${r.id} 拆解任务`}
                    onClick={() => onDecompose(r)}
                  >
                    <Layers className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`编辑 ${r.id}`}
                    onClick={() => onEdit(r)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`删除 ${r.id}`}
                    onClick={() => void onDelete(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            )
          })}
          {requirements.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-faint">
                暂无需求
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
