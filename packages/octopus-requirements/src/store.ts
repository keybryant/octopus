import type { Context } from "@deepseek-ai/cordis"
import type { Domain } from "@deepseek-ai/dsh-storage-domain"
import { REQUIREMENTS_DOMAIN, type RequirementsDomain } from "./unit.js"
import {
  assertTransition,
  RequirementsError,
  type RequirementInput,
  type RequirementPatch,
  type RequirementRecord,
} from "./types.js"

const REQ_TABLE = "requirements"
const META_TABLE = "meta"
const SEQ_KEY = "seq"

export interface RequirementStoreOptions {
  /** id 起始序号（默认 100，第一个需求为 REQ-100） */
  startSeq?: number
}

/**
 * 需求存储：domain 层提供内存读 + 每域写链 + 持久化。
 * 所有写操作在写链上串行执行并等待落盘；读操作同步走内存。
 */
export class RequirementStore {
  private constructor(private readonly domain: Domain<RequirementsDomain>) {}

  /** 打开需求域（挂载效果由调用方通过 ctx.effect 管理关闭） */
  static async open(ctx: Context, options: RequirementStoreOptions = {}): Promise<RequirementStore> {
    const domain = await ctx.storageDomain.open(REQUIREMENTS_DOMAIN)
    const store = new RequirementStore(domain)
    await store.ensureSeq(options.startSeq ?? 100)
    return store
  }

  private async ensureSeq(startSeq: number): Promise<void> {
    const meta = this.domain.table(META_TABLE)
    if (meta.get(SEQ_KEY) === undefined) {
      // meta.seq 语义：已发出的最大序号；首个 create 发 startSeq
      await meta.put(SEQ_KEY, { seq: startSeq - 1 })
    }
  }

  list(): RequirementRecord[] {
    return [...this.domain.table(REQ_TABLE).entries()]
      .map(([, record]) => record)
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  get(id: string): RequirementRecord | undefined {
    return this.domain.table(REQ_TABLE).get(id)
  }

  /** 创建需求：id 从写链上的原子序号生成，并发安全 */
  async create(input: RequirementInput): Promise<RequirementRecord> {
    const title = input.title.trim()
    if (!title) throw new RequirementsError("invalid-input", "title is required")

    const meta = this.domain.table(META_TABLE)
    const next = await meta.update(SEQ_KEY, (m) => ({ seq: m.seq + 1 }))
    const now = new Date().toISOString()
    const record: RequirementRecord = {
      id: `REQ-${next.seq}`,
      title,
      description: input.description?.trim() ?? "",
      priority: input.priority ?? "P2",
      status: "backlog",
      owner: null,
      source: input.source ?? "manual",
      createdAt: now,
      updatedAt: now,
    }
    await this.domain.table(REQ_TABLE).put(record.id, record)
    return record
  }

  /** 更新需求：状态迁移在写链槽位内校验，避免竞态 */
  async update(id: string, patch: RequirementPatch): Promise<RequirementRecord> {
    if (!this.domain.table(REQ_TABLE).get(id)) {
      throw new RequirementsError("not-found", `requirement ${id} not found`)
    }
    const table = this.domain.table(REQ_TABLE)
    return table.update(id, (current) => {
      if (patch.status !== undefined && patch.status !== current.status) {
        assertTransition(current.status, patch.status)
      }
      return { ...current, ...patch, updatedAt: new Date().toISOString() }
    })
  }

  /** 删除需求：幂等，不存在返回 false */
  async remove(id: string): Promise<boolean> {
    return this.domain.table(REQ_TABLE).delete(id)
  }

  /** 关闭域（释放后端单元）；幂等 */
  async close(): Promise<void> {
    await this.domain.close()
  }
}