import { describe, expect, it, vi } from "vitest"
import { apply } from "./index.js"

function mockContext() {
  const disposers: (() => void)[] = []
  const workbench = {
    register: vi.fn(() => {
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    }),
  }
  const webServer = {
    register: vi.fn(() => {
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    }),
  }
  let disposeAll: (() => void) | undefined
  const ctx: any = {
    workbench,
    webServer,
    effect: vi.fn((factory: () => () => void) => {
      disposeAll = factory()
    }),
  }
  return { ctx, workbench, webServer, disposers, getDisposeAll: () => disposeAll }
}

describe("octopus-quickstart", () => {
  it("registers the quickstart module with the exact contract", () => {
    const { ctx, workbench } = mockContext()
    apply(ctx)
    expect(workbench.register).toHaveBeenCalledWith({
      id: "quickstart",
      title: "快捷入口",
      order: 10,
      entry: "/octopus/quickstart/assets/index.js",
    })
  })

  it("serves its bundle under the module assets prefix", () => {
    const { ctx, webServer } = mockContext()
    apply(ctx)
    expect(webServer.register).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "prefix",
        path: "/octopus/quickstart/assets",
        handler: expect.any(Function),
      }),
    )
  })

  it("disposes both registrations", () => {
    const { ctx, disposers, getDisposeAll } = mockContext()
    apply(ctx)
    const disposeAll = getDisposeAll()!
    expect(disposeAll).toBeDefined()
    disposeAll()
    for (const dispose of disposers) expect(dispose).toHaveBeenCalled()
  })
})
