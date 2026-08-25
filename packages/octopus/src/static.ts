import { readFile } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"

export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
}

export interface HttpRequest {
  method?: string
  url?: string
}

export interface HttpResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

export function serveStaticFiles(rootDir: string, basePath: string) {
  const root = resolve(rootDir)
  return async function handler(req: HttpRequest, res: HttpResponse) {
    const method = (req.method ?? "GET").toUpperCase()
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" })
      res.end("method not allowed")
      return
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" })
      res.end("bad request")
      return
    }
    if (!pathname.startsWith(basePath + "/")) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      res.end("not found")
      return
    }
    const abs = resolve(root, "." + pathname.slice(basePath.length))
    if (abs !== root && !abs.startsWith(root + sep)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" })
      res.end("forbidden")
      return
    }
    let content: Buffer
    try {
      content = await readFile(abs)
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      res.end("not found")
      return
    }
    const type = MIME_TYPES[extname(abs).toLowerCase()] ?? "application/octet-stream"
    res.writeHead(200, {
      "content-type": type,
      "content-length": String(content.length),
    })
    if (method === "HEAD") {
      res.end()
      return
    }
    res.end(content)
  }
}
