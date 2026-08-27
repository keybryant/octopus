import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchMe, logout, redirectToLogin } from "./auth"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("fetchMe", () => {
  it("返回 me 载荷", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ user: { id: "1", username: "boss", role: "admin" }, canLogout: true }),
          { status: 200 },
        ),
      ),
    )
    await expect(fetchMe()).resolves.toMatchObject({ canLogout: true })
  })

  it("401 时抛 unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })))
    await expect(fetchMe()).rejects.toThrow(/unauthorized/)
  })
})

describe("redirectToLogin", () => {
  it("携带同源 redirect 参数跳转登录页", () => {
    const assign = vi.fn()
    Object.defineProperty(window, "location", {
      value: { href: "", pathname: "/workbench", search: "?tab=kanban", assign },
      writable: true,
    })
    redirectToLogin()
    expect(window.location.href).toBe(
      `/login?redirect=${encodeURIComponent("/workbench?tab=kanban")}`,
    )
  })
})

describe("logout", () => {
  it("POST logout 后跳转登录页", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const assign = vi.fn()
    Object.defineProperty(window, "location", {
      value: { href: "", pathname: "/workbench", search: "", assign },
      writable: true,
    })
    await logout()
    expect(fetchMock).toHaveBeenCalledWith("/api/octopus-auth/logout", {
      method: "POST",
      credentials: "same-origin",
    })
    expect(window.location.href).toBe(
      `/login?redirect=${encodeURIComponent("/workbench")}`,
    )
  })
})
