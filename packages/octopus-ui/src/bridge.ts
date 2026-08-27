/** 模块间解耦桥接：壳/插件通过 window 自定义事件与载荷传递上下文（契约层） */
export const OCTOPUS_DECOMPOSE_EVENT = "octopus:decompose-request" as const

export interface DecomposePayload {
  requirementId: string
  title: string
  description?: string
  priority?: "P0" | "P1" | "P2"
}

export type DecomposePayloadHolder = Window & { __octopusDecomposePayload?: DecomposePayload }
