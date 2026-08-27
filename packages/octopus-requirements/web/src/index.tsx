import { useCallback, useEffect, useMemo, useState } from "react"
import { Button, Spinner } from "octopus-ui"
import { Plus } from "octopus-ui"
import { OCTOPUS_DECOMPOSE_EVENT, type DecomposePayload } from "octopus-ui"
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

function compareRequirements(a: RequirementRecord, b: RequirementRecord): number {
  const na = Number(a.id.slice(4))
  const nb = Number(b.id.slice(4))
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return a.id.localeCompare(b.id)
}

/** workbench 模块：需求管理 */
export default function RequirementsModule() {
  const [requirements, setRequirements] = useState<RequirementRecord[]>([])
  const [filter, setFilter] = useState<Filter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RequirementRecord | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

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

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (record: RequirementRecord) => {
    setEditing(record)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (submitting) return
    setModalOpen(false)
    setEditing(null)
  }

  const handleCreate = async (input: NewRequirementInput) => {
    setSubmitting(true)
    setError(null)
    try {
      const created = await createRequirement({
        title: input.title,
        description: input.description,
        priority: input.priority,
      })
      setRequirements((prev) => [...prev, created].sort(compareRequirements))
      setModalOpen(false)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdate = async (input: NewRequirementInput) => {
    if (!editing) return
    setSubmitting(true)
    setError(null)
    try {
      const updated = await updateRequirement(editing.id, {
        title: input.title,
        description: input.description,
        priority: input.priority,
      })
      setRequirements((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setModalOpen(false)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleStatusChange = async (id: string, status: RequirementStatus) => {
    setBusyIds((prev) => new Set(prev).add(id))
    setError(null)
    try {
      const updated = await updateRequirement(id, { status })
      setRequirements((prev) => prev.map((r) => (r.id === id ? updated : r)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleDecompose = (record: RequirementRecord) => {
    const detail: DecomposePayload = {
      requirementId: record.id,
      title: record.title,
      description: record.description || undefined,
      priority: record.priority,
    }
    window.dispatchEvent(new CustomEvent<DecomposePayload>(OCTOPUS_DECOMPOSE_EVENT, { detail }))
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(`确定删除需求 ${id}？`)) return
    setBusyIds((prev) => new Set(prev).add(id))
    setError(null)
    try {
      await removeRequirement(id)
      setRequirements((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
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
        <Button variant="primary" size="sm" onClick={openCreate}>
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
          onEdit={openEdit}
          onDecompose={handleDecompose}
          busyIds={busyIds}
        />
      )}

      <NewRequirementModal
        open={modalOpen}
        initial={editing}
        submitting={submitting}
        onClose={closeModal}
        onSubmit={editing ? handleUpdate : handleCreate}
      />
    </section>
  )
}
