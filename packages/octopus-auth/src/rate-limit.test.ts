import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRateLimiter } from "./rate-limit.js"
import { HttpError } from "./errors.js"

const OPTS = { windowMs: 15 * 60_000, maxFailures: 5 }

describe("createRateLimiter", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("阈值内允许尝试", () => {
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 4; i++) rl.recordFailure("ip1")
    expect(() => rl.assertAllowed("ip1")).not.toThrow()
  })

  it("第 5 次失败后锁定并抛 429", () => {
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 5; i++) rl.recordFailure("ip1")
    try {
      rl.assertAllowed("ip1")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError)
      expect((e as HttpError).statusCode).toBe(429)
      expect((e as HttpError).code).toBe("rate-limited")
    }
  })

  it("成功登录清零", () => {
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 5; i++) rl.recordFailure("ip1")
    rl.recordSuccess("ip1")
    expect(() => rl.assertAllowed("ip1")).not.toThrow()
  })

  it("不同桶互不影响", () => {
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 5; i++) rl.recordFailure("ip1")
    expect(() => rl.assertAllowed("ip2")).not.toThrow()
  })

  it("持续失败指数退避：解锁后立即再败则锁更久", () => {
    const start = Date.now()
    vi.setSystemTime(start)
    const rl = createRateLimiter(OPTS)
    for (let i = 0; i < 5; i++) rl.recordFailure("ip1")
    vi.setSystemTime(start + OPTS.windowMs + 1)
    expect(() => rl.assertAllowed("ip1")).not.toThrow()
    rl.recordFailure("ip1")                                   // 第 6 次 → 约 2 分钟退避
    vi.setSystemTime(start + OPTS.windowMs + 1 + 60_000)
    expect(() => rl.assertAllowed("ip1")).toThrow(HttpError)
    vi.setSystemTime(start + OPTS.windowMs + 1 + 2 * 60_000)
    expect(() => rl.assertAllowed("ip1")).not.toThrow()
  })
})
