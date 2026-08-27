import { describe, expect, it } from "vitest"
import { renderLoginPage } from "./login-page.js"

describe("renderLoginPage", () => {
  const html = renderLoginPage({ needsSetup: false })

  it("单文件：无任何外部资源引用", () => {
    expect(html).toContain("<form")
    expect(html).toContain("<script>")
    expect(html.toLowerCase()).not.toContain("src=")
    expect(html.toLowerCase()).not.toContain("href=")
  })

  it("redirect 参数做同源相对路径校验", () => {
    expect(html).toContain("/^\\/(?!\\/)/")
  })

  it("needsSetup 时显示初始化提示", () => {
    expect(renderLoginPage({ needsSetup: true })).toContain("尚未配置初始管理员")
    expect(html).not.toContain("尚未配置初始管理员")
  })
})
