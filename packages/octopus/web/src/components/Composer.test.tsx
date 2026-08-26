import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { QUICK_PROMPTS } from "../lib/datasource"
import { Composer } from "./Composer"

const PLACEHOLDER = /给 Octo Agent 下指令/

describe("Composer", () => {
  it("renders quick prompt chips and fills input on click", () => {
    render(<Composer quickPrompts={QUICK_PROMPTS} contextLabel="Octopus Platform · 迭代 4.2" onSend={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "📋 列出今日待办" }))
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue("📋 列出今日待办")
    expect(screen.getByText(/上下文：Octopus Platform · 迭代 4.2/)).toBeInTheDocument()
  })

  it("submits on Enter, newline on Shift+Enter", () => {
    const onSend = vi.fn()
    render(<Composer quickPrompts={[]} contextLabel="c" onSend={onSend} />)
    const box = screen.getByPlaceholderText(PLACEHOLDER)
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.input(box, { target: { value: "你好" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(onSend).toHaveBeenCalledWith("你好")
    expect(box).toHaveValue("")
  })

  it("does not submit on Enter during IME composition", () => {
    const onSend = vi.fn()
    render(<Composer quickPrompts={[]} contextLabel="c" onSend={onSend} />)
    const box = screen.getByPlaceholderText(PLACEHOLDER)
    fireEvent.input(box, { target: { value: "nihao" } })
    fireEvent.keyDown(box, { key: "Enter", isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
    // 组合结束后同一文本可正常发送
    fireEvent.keyDown(box, { key: "Enter" })
    expect(onSend).toHaveBeenCalledWith("nihao")
  })

  it("send button submits trimmed text", () => {
    const onSend = vi.fn()
    render(<Composer quickPrompts={[]} contextLabel="c" onSend={onSend} />)
    const box = screen.getByPlaceholderText(PLACEHOLDER)
    fireEvent.input(box, { target: { value: "  拆解需求  " } })
    fireEvent.click(screen.getByTitle("发送"))
    expect(onSend).toHaveBeenCalledWith("拆解需求")
  })
})
