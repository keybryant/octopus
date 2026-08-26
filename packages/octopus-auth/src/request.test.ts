import { describe, expect, it } from "vitest"
import {
  assertSameOrigin, bucketKeyOf, buildClearCookie, buildSetCookie,
  parseCookies, sessionCookieName,
} from "./request.js"
import { HttpError } from "./errors.js"

describe("parseCookies", () => {
  it("解析 cookie 头", () => {
    expect(parseCookies("a=1; octopus_session=xyz")).toEqual({ a: "1", octopus_session: "xyz" })
    expect(parseCookies(undefined)).toEqual({})
  })
})

describe("cookie 构造", () => {
  it("名称随 secure 切换且永不携带 Domain", () => {
    expect(sessionCookieName(false)).toBe("octopus_session")
    expect(sessionCookieName(true)).toBe("__Host-octopus_session")
    const c = buildSetCookie("__Host-octopus_session", "id1", 3600, true)
    expect(c).toContain("HttpOnly")
    expect(c).toContain("SameSite=Lax")
    expect(c).toContain("Path=/")
    expect(c).toContain("Secure")
    expect(c).not.toContain("Domain")
    expect(buildClearCookie("octopus_session")).toBe(
      "octopus_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    )
  })
})

describe("bucketKeyOf", () => {
  it("默认取 socket 地址（反代下退化为全局桶）", () => {
    expect(bucketKeyOf({ socket: { remoteAddress: "127.0.0.1" } }, false)).toBe("127.0.0.1")
    expect(bucketKeyOf({}, false)).toBe("unknown")
  })
  it("trustProxy 时优先 XFF 首值", () => {
    const req = { socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }
    expect(bucketKeyOf(req, true)).toBe("9.9.9.9")
    expect(bucketKeyOf({ headers: {} }, true)).toBe("unknown")
  })
})

describe("assertSameOrigin", () => {
  it("GET 放行", () => expect(() => assertSameOrigin({ method: "GET" })).not.toThrow())
  it("变更请求缺 Origin 抛 403", () => expect(() => assertSameOrigin({ method: "POST" })).toThrow(HttpError))
  it("跨域 Origin 抛 403", () => {
    expect(() => assertSameOrigin({
      method: "POST", headers: { origin: "https://evil.com", host: "wb.example.com" },
    })).toThrow(HttpError)
  })
  it("同源放行（scheme 不限）", () => {
    expect(() => assertSameOrigin({
      method: "DELETE", headers: { origin: "http://wb.example.com", host: "wb.example.com" },
    })).not.toThrow()
    expect(() => assertSameOrigin({
      method: "PATCH", headers: { origin: "https://wb.example.com", host: "wb.example.com" },
    })).not.toThrow()
  })
})
