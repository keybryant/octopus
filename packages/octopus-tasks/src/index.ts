import type { Context } from "@deepseek-ai/cordis"

export const name = "octopus-tasks"
export const inject = ["workbench", "webServer", "storageDomain"]

/** 功能插件: 任务看板(模块注册 + REST API + 前端 bundle 托管), apply 在后续任务补充 */
export function apply(_ctx: Context) {}

export default { name, inject, apply }
