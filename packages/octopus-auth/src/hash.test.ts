import { describe, expect, it } from "vitest"
import { DUMMY_HASH, hashPassword, verifyPassword } from "./hash.js"
import { resolveAuthConfig, AuthConfigSchema, DEFAULT_AUTH_CONFIG } from "./config.js"

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
    await expect(verifyPassword("x", "scrypt$16384$8$1$$")).resolves.toBe(false)
  })

  it("盐或密钥长度不符的存储串返回 false", async () => {
    const stored = await hashPassword("s3cret-pass")
    const [, , , , , keyHex] = stored.split("$")
    await expect(verifyPassword("s3cret-pass", `scrypt$16384$8$1$abcd$${keyHex}`)).resolves.toBe(false)
    await expect(verifyPassword("s3cret-pass", `scrypt$16384$8$1$$${keyHex}`)).resolves.toBe(false)
    await expect(verifyPassword("s3cret-pass", stored.slice(0, -2))).resolves.toBe(false)
    await expect(verifyPassword("x", "scrypt$16384$8$1$$")).resolves.toBe(false)
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

describe("AuthConfigSchema bootstrapAdmin", () => {
  it("缺失时结果中无 truthy 的 bootstrapAdmin，且不留显式 undefined 键", () => {
    const parsed = AuthConfigSchema({})
    expect(Object.hasOwn(parsed, "bootstrapAdmin")).toBe(false)
    expect(parsed.bootstrapAdmin).toBeFalsy()
    const resolved = resolveAuthConfig(AuthConfigSchema({}))
    expect(resolved.bootstrapAdmin).toBeUndefined()
    expect(Object.hasOwn(resolved, "bootstrapAdmin")).toBe(false)
    expect(Object.hasOwn(resolveAuthConfig(), "bootstrapAdmin")).toBe(false)
  })

  it("部分对象（缺 username/password）被拒绝", () => {
    expect(() => AuthConfigSchema({ bootstrapAdmin: { username: "u" } as never })).toThrow()
    expect(() => AuthConfigSchema({ bootstrapAdmin: { password: "p" } as never })).toThrow()
    expect(() => AuthConfigSchema({ bootstrapAdmin: {} as never })).toThrow()
    expect(() => resolveAuthConfig({ bootstrapAdmin: { username: "u" } } as never)).not.toThrow()
  })

  it("完整 bootstrapAdmin 被保留；不完整输入在 resolve 时按缺失处理", () => {
    const admin = { username: "admin", password: "secret" }
    expect(AuthConfigSchema({ bootstrapAdmin: admin })).toMatchObject({ bootstrapAdmin: admin })
    expect(resolveAuthConfig({ bootstrapAdmin: admin }).bootstrapAdmin).toEqual(admin)
    expect(resolveAuthConfig({} as never).bootstrapAdmin).toBeUndefined()
  })
})
