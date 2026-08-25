import { Button } from "octopus-ui"
import { Archive, CheckSquare, ChevronLeft, FileText, GitCommitHorizontal } from "octopus-ui"
import type { Artifact } from "../lib/types"

export interface ArtifactsRailProps {
  artifacts: Artifact[]
  collapsed: boolean
  onCollapse: () => void
  onExpand: () => void
}

const KIND_LABELS: Record<Artifact["kind"], string> = {
  task: "任务",
  doc: "文档",
  commit: "代码提交",
}

function ArtifactIcon({ kind }: { kind: Artifact["kind"] }) {
  if (kind === "commit") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 font-mono text-[10px] text-accent">
        a3f
      </span>
    )
  }
  if (kind === "doc") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-hover">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    )
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10">
      <CheckSquare className="h-3.5 w-3.5 text-accent" />
    </span>
  )
}

const KIND_ORDER: Artifact["kind"][] = ["task", "doc", "commit"]

export function ArtifactsRail({ artifacts, collapsed, onCollapse, onExpand }: ArtifactsRailProps) {
  if (collapsed) {
    return (
      <button
        type="button"
        title="展开产出面板"
        onClick={onExpand}
        className="fixed right-0 top-1/2 z-sticky flex h-10 w-6 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-border-strong bg-surface text-text-faint transition-colors hover:text-accent"
      >
        <ChevronLeft className="h-4 w-4 rotate-180" />
      </button>
    )
  }

  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">本会话产出</span>
        <button
          type="button"
          title="收起"
          onClick={onCollapse}
          className="rounded p-1 text-text-faint transition-colors hover:bg-surface hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {KIND_ORDER.map((kind) => {
          const items = artifacts.filter((a) => a.kind === kind)
          if (items.length === 0) return null
          return (
            <div key={kind}>
              <div className="px-1 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                {KIND_LABELS[kind]} · {items.length}
              </div>
              {items.map((a) => (
                <div key={a.id} className="flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-hover">
                  <ArtifactIcon kind={a.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{a.title}</div>
                    <div className="truncate text-[11px] text-text-faint">{a.subtitle}</div>
                  </div>
                  {a.live && (
                    <span
                      data-testid="artifact-live-dot"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                    />
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <Button variant="ghost" size="sm" className="w-full border border-dashed border-border-strong text-xs hover:border-accent hover:text-accent">
          <Archive className="h-3.5 w-3.5" />
          归档全部产出
        </Button>
      </div>
    </aside>
  )
}
