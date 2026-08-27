import type { IncomingMessage } from "node:http"
import { httpError } from "./errors.js"

const MAX_BODY_BYTES = 64 * 1024

export async function parseBody(req: IncomingMessage, bodyText?: string): Promise<unknown> {
  if (typeof bodyText === "string") {
    try {
      return JSON.parse(bodyText)
    } catch {
      throw httpError(400, "bad-request", "请求体不是合法 JSON")
    }
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > MAX_BODY_BYTES) throw httpError(413, "payload-too-large", "请求体过大")
    chunks.push(chunk as Buffer)
  }
  if (total === 0) throw httpError(400, "bad-request", "请求体不能为空")
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw httpError(400, "bad-request", "请求体不是合法 JSON")
  }
}
