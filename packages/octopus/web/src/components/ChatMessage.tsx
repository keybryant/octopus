import { Badge, Button, Spinner } from "octopus-ui"
import { Check } from "octopus-ui"
import type { BadgeTone as UiBadgeTone } from "octopus-ui"
import type { ChatMessage as ChatMessageData, InlineSeg, MessageBlock } from "../lib/types"
import { OctoLogo } from "./OctoLogo"

export type ApprovalDecision = "allow" | "deny"

/** 领域徽章色 → 设计系统语义色 */
const badgeToneMap: Record<string, UiBadgeTone> = {
  green: "success",
  blue: "info",
  gray: "neutral",
  orange: "warn",
}

function Seg({ seg }: { seg: InlineSeg }) {
  const cls =
    seg.accent === "green"
      ? "font-mono text-accent"
      : seg.accent === "orange"
        ? "font-mono text-warn"
        : seg.accent === "strong"
          ? "font-medium text-foreground"
          : undefined
  return <span className={cls}>{seg.text}</span>
}

function SegLine({ segs }: { segs: InlineSeg[] }) {
  return (
    <>
      {segs.map((s, i) => (
        <Seg key={i} seg={s} />
      ))}
    </>
  )
}

const stepTextClasses = {
  done: "text-muted-foreground",
  active: "text-foreground",
  pending: "text-text-faint",
} as const

function StepRow({ state, text }: { state: "done" | "active" | "pending"; text: string }) {
  return (
    <div data-testid={`step-${state}`} className="flex items-center gap-2 text-xs">
      {state === "done" && <Check className="h-3 w-3 shrink-0 text-accent" strokeWidth={2.5} />}
      {state === "active" && <Spinner size="sm" className="shrink-0" />}
      {state === "pending" && (
        <span className="h-3 w-3 shrink-0 rounded-full border border-border-strong" aria-hidden="true" />
      )}
      <span className={stepTextClasses[state]}>{text}</span>
    </div>
  )
}

function Block({
  block,
  onApprovalDecision,
  decidedApprovalIds,
}: {
  block: MessageBlock
  onApprovalDecision?: (id: string, decision: ApprovalDecision) => void
  decidedApprovalIds?: ReadonlySet<string>
}) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p>
          <SegLine segs={block.segs} />
        </p>
      )
    case "bullets":
      return (
        <ul className="mt-2 list-inside list-disc space-y-1.5 text-muted-foreground">
          {block.items.map((item, i) => (
            <li key={i}>
              <SegLine segs={item} />
            </li>
          ))}
        </ul>
      )
    case "steps":
      return (
        <div className="mt-2 space-y-1.5">
          {block.items.map((s, i) => (
            <StepRow key={i} state={s.state} text={s.text} />
          ))}
        </div>
      )
    case "cards":
      return (
        <div className="mt-3 space-y-2">
          {block.cards.map((card, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              {card.badge && <Badge tone={badgeToneMap[card.badge.tone]}>{card.badge.label}</Badge>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{card.title}</div>
                <div className="mt-0.5 text-[11.5px] text-text-faint">{card.hint}</div>
              </div>
              {card.actionLabel && (
                <button
                  type="button"
                  className="shrink-0 cursor-pointer text-xs text-accent transition duration-fast hover:brightness-110"
                >
                  {card.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )
    case "actions":
      return (
        <div className="mt-3 flex gap-3 border-t border-border pt-3">
          {block.actions.map((a) => (
            <button
              key={a}
              type="button"
              className="cursor-pointer text-xs text-muted-foreground transition-colors duration-fast hover:text-foreground"
            >
              {a}
            </button>
          ))}
        </div>
      )
    case "code":
      return (
        <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-surface px-3 py-1.5 font-mono text-[10.5px] text-text-faint">
            {block.filename}
          </div>
          <pre className="overflow-x-auto bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
            {block.code}
          </pre>
        </div>
      )
    case "notice": {
      const danger = block.tone === "danger"
      return (
        <div
          data-testid={danger ? "notice-danger" : undefined}
          className={danger ? "mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3" : "mt-3 rounded-lg border border-border bg-background p-3"}
        >
          <div className={danger ? "text-xs font-medium text-danger" : "text-xs font-medium text-accent"}>{block.title}</div>
          <div className="mt-0.5 text-[11px] text-text-faint">{block.hint}</div>
        </div>
      )
    }
    case "approval": {
      const decided = decidedApprovalIds?.has(block.approvalId) ?? false
      return (
        <div data-testid={`approval-${block.approvalId}`} className="mt-3 rounded-lg border border-border bg-background p-3">
          <div className="text-xs font-medium text-foreground">{block.toolName}</div>
          {block.reason && <div className="mt-0.5 text-[11px] text-muted-foreground">{block.reason}</div>}
          <div className="mt-2.5 flex gap-2">
            <Button variant="primary" size="sm" disabled={decided} onClick={() => onApprovalDecision?.(block.approvalId, "allow")}>
              允许
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              disabled={decided}
              onClick={() => onApprovalDecision?.(block.approvalId, "deny")}
            >
              拒绝
            </Button>
          </div>
        </div>
      )
    }
  }
}

export function ChatMessage({
  message,
  onApprovalDecision,
  decidedApprovalIds,
}: {
  message: ChatMessageData
  onApprovalDecision?: (id: string, decision: ApprovalDecision) => void
  decidedApprovalIds?: ReadonlySet<string>
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          data-testid="msg-user"
          className="max-w-[80%] rounded-xl rounded-tr-sm border border-info/30 bg-info/15 px-4 py-3 text-[13.5px] leading-relaxed text-foreground"
        >
          {message.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
        <OctoLogo className="h-4 w-4 text-accent" />
      </div>
      <div className="min-w-0 max-w-[88%]">
        <div className="rounded-xl rounded-tl-sm border border-border bg-surface px-4 py-3.5 text-[13.5px] leading-relaxed text-muted-foreground">
          {message.text && <p>{message.text}</p>}
          {message.blocks?.map((b, i) => (
            <Block key={i} block={b} onApprovalDecision={onApprovalDecision} decidedApprovalIds={decidedApprovalIds} />
          ))}
        </div>
        {message.meta && (
          <div className="mt-1.5 font-mono text-[10.5px] text-text-faint">{message.meta}</div>
        )}
      </div>
    </div>
  )
}
