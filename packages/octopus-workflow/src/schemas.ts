/** 工具输出 JSON-schema 常量（defineTool output.schema 使用；参数 schema 在工具定义内联） */
export const requirementFields = {
  id: { type: "string", required: true },
  title: { type: "string", required: true },
  description: { type: "string", required: true },
  priority: { type: "string", required: true, enum: ["P0", "P1", "P2"] },
  status: { type: "string", required: true, enum: ["backlog", "planned", "in-progress", "review", "done"] },
  projectId: { type: "string", required: true },
  source: { type: "string", required: true, enum: ["manual", "chat"] },
  createdAt: { type: "string", required: true },
  updatedAt: { type: "string", required: true },
} as const

export const requirementObjectSchema = {
  type: "object", additionalProperties: false, properties: requirementFields,
} as const

export const requirementListSchema = {
  type: "array", items: requirementObjectSchema,
} as const

export const taskFields = {
  id: { type: "string", required: true },
  title: { type: "string", required: true },
  description: { type: "string", required: true },
  requirementId: { type: "string", required: true },
  projectId: { type: "string", required: true },
  status: { type: "string", required: true, enum: ["todo", "doing", "review", "done"] },
  agentSessionId: { type: "string" },
  agentSummary: { type: "string" },
  createdAt: { type: "string", required: true },
  updatedAt: { type: "string", required: true },
} as const

export const taskObjectSchema = {
  type: "object", additionalProperties: false, properties: taskFields,
} as const

export const taskListSchema = {
  type: "array", items: taskObjectSchema,
} as const

export const projectFields = {
  id: { type: "string", required: true },
  name: { type: "string", required: true },
  description: { type: "string", required: true },
  status: { type: "string", required: true, enum: ["active", "paused", "done", "archived"] },
  workspacePath: { type: "string", required: true },
  workspaceId: { type: "string", required: true },
  createdAt: { type: "string", required: true },
} as const

export const projectObjectSchema = {
  type: "object", additionalProperties: false, properties: projectFields,
} as const

export const projectListSchema = {
  type: "array", items: projectObjectSchema,
} as const
