import { describe, expect, it } from "vitest"
import { DUMMY_HASH, hashPassword, verifyPassword } from "./hash.js"
import { resolveAuthConfig, DEFAULT_AUTH_CONFIG } from "./config.js"

describe("hashPassword/verifyPassword", () => {
  it("哈希带参数头且可校验", async () => {
    const stored = await hashPassword("s3cret-pass")
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    await expect(verifyPassword("s3cret-pass", stored)).resolves.toBe(true)
    await expect(verifyPassword("wrong-pass", stored)).resolves.toBe(false)
  })

  it("相同密码两次哈希产生不同盐", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"))
  })

  it("畸形存储串安全返回 false", async () => {
    await expect(verifyPassword("x", "garbage")).resolves.toBe(false)
    await expect(verifyPassword("x", "bcrypt$1$2$3$4$5")).resolves.toBe(false)
  })

  it("DUMMY_HASH 是可用哈希", async () => {
    await expect(verifyPassword("octopus-dummy-password-for-timing", await DUMMY_HASH)).resolves.toBe(true)
  })
})

describe("resolveAuthConfig", () => {
  it("默认值符合规范", () => {
    expect(resolveAuthConfig()).toEqual(DEFAULT_AUTH_CONFIG)
    expect(DEFAULT_AUTH_CONFIG.mode).toBe("multi-user")
    expect(DEFAULT_AUTH_CONFIG.sessionTtlDays).toBe(7)
  })
})
