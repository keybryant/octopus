import { httpError } from "./errors.js"

export interface RateLimitOptions {
  windowMs: number
  maxFailures: number
}

export interface RateLimiter {
  assertAllowed(bucket: string): void
  recordFailure(bucket: string): void
  recordSuccess(bucket: string): void
}

interface BucketState {
  failures: number
  windowStart: number
  lockedUntil: number
  lastActivity: number
}

const LOCK_CAP_MS = 64 * 60_000
const MIN_LOCK_MS = 60_000
const BUCKET_CAP = 10_000

export function createRateLimiter(options: RateLimitOptions): RateLimiter & { size(): number } {
  const buckets = new Map<string, BucketState>()

  function pruneStale(now: number): void {
    if (buckets.size <= BUCKET_CAP) return
    for (const [key, s] of buckets) {
      if (s.lockedUntil <= now && now - s.lastActivity >= options.windowMs) {
        buckets.delete(key)
      }
    }
  }

  return {
    assertAllowed(bucket: string): void {
      const s = buckets.get(bucket)
      if (!s) return
      s.lastActivity = Date.now()
      if (Date.now() < s.lockedUntil) {
        const retryAfterSec = Math.ceil((s.lockedUntil - Date.now()) / 1000)
        throw httpError(429, "rate-limited", `尝试过于频繁，请 ${retryAfterSec} 秒后再试`)
      }
    },

    recordFailure(bucket: string): void {
      pruneStale(Date.now())
      let s = buckets.get(bucket)
      if (!s) {
        s = { failures: 0, windowStart: Date.now(), lockedUntil: 0, lastActivity: Date.now() }
        buckets.set(bucket, s)
      }
      s.failures += 1
      s.lastActivity = Date.now()
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

    size(): number {
      return buckets.size
    },
  }
}
