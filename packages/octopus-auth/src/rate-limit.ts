import { httpError } from "./errors.js"

export interface RateLimitOptions {
  windowMs: number
  maxFailures: number
}

interface BucketState {
  failures: number
  windowStart: number
  lockedUntil: number
}

const LOCK_CAP_MS = 64 * 60_000
const MIN_LOCK_MS = 60_000

export function createRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, BucketState>()

  return {
    assertAllowed(bucket: string): void {
      const s = buckets.get(bucket)
      if (!s) return
      if (Date.now() < s.lockedUntil) {
        const retryAfterSec = Math.ceil((s.lockedUntil - Date.now()) / 1000)
        throw httpError(429, "rate-limited", `尝试过于频繁，请 ${retryAfterSec} 秒后再试`)
      }
    },

    recordFailure(bucket: string): void {
      let s = buckets.get(bucket)
      if (!s) {
        s = { failures: 0, windowStart: Date.now(), lockedUntil: 0 }
        buckets.set(bucket, s)
      }
      s.failures += 1
      if (s.failures >= options.maxFailures) {
        const extra = s.failures - options.maxFailures
        const backoffMs = Math.min(2 ** extra * 60_000, LOCK_CAP_MS)
        const windowLeftMs = s.windowStart + options.windowMs - Date.now()
        s.lockedUntil = Date.now() + Math.max(backoffMs, windowLeftMs, MIN_LOCK_MS)
      }
    },

    recordSuccess(bucket: string): void {
      buckets.delete(bucket)
    },
  }
}
