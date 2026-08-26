import { describe, expect, it } from "vitest"
import { WriteChain } from "./write-chain.js"

describe("WriteChain", () => {
  it("按提交顺序串行执行任务", async () => {
    const chain = new WriteChain()
    const order: number[] = []
    const jobs = [1, 2, 3].map((n) =>
      chain.run(async () => {
        await new Promise((r) => setTimeout(r, 3 - n))
        order.push(n)
        return n * 10
      }),
    )
    expect(await Promise.all(jobs)).toEqual([10, 20, 30])
    expect(order).toEqual([1, 2, 3])
  })

  it("前一个任务失败不阻断后续任务", async () => {
    const chain = new WriteChain()
    await expect(chain.run(async () => { throw new Error("boom") })).rejects.toThrow("boom")
    await expect(chain.run(async () => "ok")).resolves.toBe("ok")
  })
})
