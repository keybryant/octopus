import type { Context } from "@deepseek-ai/cordis"
import type { Domain } from "@deepseek-ai/dsh-storage-domain"
import { TASKS_DOMAIN, type TasksDomain } from "./unit.js"
import {
  assertTransition,
  TasksError,
  type TaskInput,
  type TaskPatch,
  type TaskRecord,
} from "./types.js"

const TASK_TABLE = "tasks"
const META_TABLE = "meta"
const SEQ_KEY = "seq"

export interface TaskStoreOptions {
  /** id 起始序号（默认 2800，与历史 mock 看板 TASK-28xx 样式对齐） */
  startSeq?: number
}

export class TaskStore {
  private constructor(private readonly domain: Domain<TasksDomain>) {}

  static async open(ctx: Context, options: TaskStoreOptions = {}): Promise<TaskStore> {
    const domain = await ctx.storageDomain.open(TASKS_DOMAIN)
    const store = new TaskStore(domain)
    await store.ensureSeq(options.startSeq ?? 2800)
    return store
  }

  private async ensureSeq(startSeq: number): Promise<void> {
    const meta = this.domain.table(META_TABLE)
    if (meta.get(SEQ_KEY) === undefined) {
      await meta.put(SEQ_KEY, { seq: startSeq - 1 })
    }
  }

  list(filter?: (record: TaskRecord) => boolean): TaskRecord[] {
    return [...this.domain.table(TASK_TABLE).entries()]
      .map(([, record]) => record)
      .filter((record) => filter?.(record) ?? true)
      .sort((a, b) => {
        const na = Number(a.id.slice(5))
        const nb = Number(b.id.slice(5))
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
        return a.id.localeCompare(b.id)
      })
  }

  get(id: string): TaskRecord | undefined {
    return this.domain.table(TASK_TABLE).get(id)
  }

  async create(input: TaskInput): Promise<TaskRecord> {
    this.assertTaskInput(input)
    const meta = this.domain.table(META_TABLE)
    const next = await meta.update(SEQ_KEY, (m) => ({ seq: m.seq + 1 }))
    const record = this.buildRecord(`TASK-${next.seq}`, input)
    await this.domain.table(TASK_TABLE).put(record.id, record)
    return record
  }

  /** 校验入参（供 create 与 createBatch 共用；id 序号分配前调用，保证失败零写入） */
  private assertTaskInput(input: TaskInput): void {
    if (!input.title.trim()) throw new TasksError("invalid-input", "title is required")
    if (!input.requirementId.trim()) throw new TasksError("invalid-input", "requirementId is required")
    if (!input.projectId.trim()) throw new TasksError("invalid-input", "projectId is required")
  }

  private buildRecord(id: string, input: TaskInput): TaskRecord {
    const now = new Date().toISOString()
    return {
      id,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      requirementId: input.requirementId.trim(),
      projectId: input.projectId.trim(),
      priority: input.priority ?? "P2",
      status: "todo",
      assignee: input.assignee?.trim() || null,
      createdAt: now,
      updatedAt: now,
    }
  }

  async update(id: string, patch: TaskPatch): Promise<TaskRecord> {
    if (!this.domain.table(TASK_TABLE).get(id)) {
      throw new TasksError("not-found", `task ${id} not found`)
    }
    if (Object.keys(patch).length === 0) {
      throw new TasksError("invalid-input", "no fields to update")
    }
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new TasksError("invalid-input", "title is required")
    }
    const table = this.domain.table(TASK_TABLE)
    return table.update(id, (current) => {
      if (patch.status !== undefined && patch.status !== current.status) {
        assertTransition(current.status, patch.status)
      }
      const next: TaskRecord = { ...current, ...patch, updatedAt: new Date().toISOString() }
      if (patch.title !== undefined) next.title = patch.title.trim()
      if (patch.assignee !== undefined) next.assignee = patch.assignee?.trim() || null
      return next
    })
  }

  async remove(id: string): Promise<boolean> {
    return this.domain.table(TASK_TABLE).delete(id)
  }

  async close(): Promise<void> {
    await this.domain.close()
  }
}
