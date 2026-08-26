import { useCallback, useEffect, useMemo, useState } from "react"
import { Button, Spinner } from "octopus-ui"
import { Plus } from "octopus-ui"
import { createRequirement, listRequirements, removeRequirement, updateRequirement } from "./api"
import { NewRequirementModal, type NewRequirementInput } from "./components/NewRequirementModal"
import { RequirementsTable } from "./components/RequirementsTable"
import { STATUS_META, STATUS_ORDER } from "./status"
import type { RequirementRecord, RequirementStatus } from "./types"
import "./index.css"

type Filter = RequirementStatus | "all"

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "全部" },
  ...STATUS_ORDER.map((s) => ({ value: s as Filter, label: STATUS_META[s].label })),
]

/** workbench 模块：需求管理 */
export default function RequirementsModule() {
  const [requirements, setRequirements] = useState<RequirementRecord[]>([])
  const [filter, setFilter] = useState<Filter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRequirements(await listRequirements())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async (input: NewRequirementInput) => {
    setCreating(true)
    try {
      await createRequirement(input)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const handleStatusChange = async (id: string, status: RequirementStatus) => {
    setBusyId(id)
    try {
      await updateRequirement(id, { status })
      setRequirements((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(`确定删除需求 ${id}？`)) return
    setBusyId(id)
    try {
      await removeRequirement(id)
      setRequirements((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(
    () => (filter === "all" ? requirements : requirements.filter((r) => r.status === filter)),
    [requirements, filter],
  )

  return (
    <section className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-base font-semibold">需求管理</h2>
        <span className="text-xs text-text-faint">共 {requirements.length} 条</span>
        <span className="flex-1" />
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          新建需求
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={
              filter === f.value
                ? "cursor-pointer rounded-full border border-border-strong bg-surface-hover px-3 py-1 text-xs font-medium"
                : "cursor-pointer rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface"
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-6 text-center text-sm text-danger">
          {error}
          <div className="mt-2">
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              重试
            </Button>
          </div>
        </div>
      ) : (
        <RequirementsTable
          requirements={filtered}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          busyId={busyId}
        />
      )}

      <NewRequirementModal
        open={createOpen}
        submitting={creating}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
    </section>
  )
}
