import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { serveStaticFiles } from "./static.js"

function createRes() {
  const calls: { status: number; headers: Record<string, string>; body: string }[] = []
  return {
    calls,
    writeHead(status: number, headers: Record<string, string> = {}) {
      calls.push({ status, headers, body: "" })
    },
    end(body?: string | Uint8Array) {
      calls[calls.length - 1].body += String(body ?? "")
    },
  }
}

describe("serveStaticFiles", () => {
  let root = ""
  let handler: ReturnType<typeof serveStaticFiles>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "octopus-static-"))
    writeFileSync(join(root, "index.js"), "console.log(1)")
    writeFileSync(join(root, "app.css"), "body {}")
    writeFileSync(join(root, "blob.bin"), "\u0000\u0001")
    handler = serveStaticFiles(root, "/workbench/assets")
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("serves a file with correct content-type", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/index.js" }, res)
    expect(res.calls[0].status).toBe(200)
    expect(res.calls[0].headers["content-type"]).toBe("text/javascript; charset=utf-8")
    expect(res.calls[0].body).toBe("console.log(1)")
  })

  it("serves unknown extensions as octet-stream", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/blob.bin" }, res)
    expect(res.calls[0].headers["content-type"]).toBe("application/octet-stream")
  })

  it("HEAD returns headers without body", async () => {
    const res = createRes()
    await handler({ method: "HEAD", url: "/workbench/assets/index.js" }, res)
    expect(res.calls[0].status).toBe(200)
    expect(res.calls[0].body).toBe("")
  })

  it("rejects non-GET/HEAD methods", async () => {
    const res = createRes()
    await handler({ method: "POST", url: "/workbench/assets/index.js" }, res)
    expect(res.calls[0].status).toBe(405)
  })

  it("rejects traversal outside the root", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/..%2F..%2Fpackage.json" }, res)
    expect(res.calls[0].status).toBe(403)
  })

  it("returns 404 for missing files", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/nope.js" }, res)
    expect(res.calls[0].status).toBe(404)
  })

  it("returns 404 for paths outside the base", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/other/index.js" }, res)
    expect(res.calls[0].status).toBe(404)
  })

  it("returns 400 for malformed percent encoding", async () => {
    const res = createRes()
    await handler({ method: "GET", url: "/workbench/assets/%zz" }, res)
    expect(res.calls[0].status).toBe(400)
  })
})
