import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { NewProjectModal, deriveShortName } from "./NewProjectModal"

interface Payload {
  name: string
  shortName: string
  description: string
}

describe("deriveShortName", () => {
  it("takes first two chars for Chinese names", () => {
    expect(deriveShortName("章鱼工作台")).toBe("章鱼")
  })
  it("takes initials of first two English words", () => {
    expect(deriveShortName("Octopus Platform")).toBe("OP")
  })
})

describe("NewProjectModal", () => {
  const NAME_PLACEHOLDER = /例如：Octopus Platform/

  function mount(handlers: { onCreate: (data: Payload) => void; onClose?: () => void }) {
    return render(
      <NewProjectModal open onClose={handlers.onClose ?? (() => {})} onCreate={handlers.onCreate} />,
    )
  }

  function fill(payload: Partial<Payload>) {
    if (payload.name !== undefined)
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: payload.name },
      })
    if (payload.shortName !== undefined)
      fireEvent.change(screen.getByPlaceholderText(/留空自动生成|两字符/), {
        target: { value: payload.shortName },
      })
    if (payload.description !== undefined)
      fireEvent.change(screen.getByPlaceholderText(/一句话说明项目目标/), {
        target: { value: payload.description },
      })
  }

  it("auto-derives short name preview from project name", () => {
    mount({ onCreate: vi.fn() })
    fill({ name: "Merchant Portal" })
    expect(screen.getByText("MP")).toBeInTheDocument()
  })

  it("disables submit until name is filled", () => {
    mount({ onCreate: vi.fn() })
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled()
    fill({ name: "Merchant Portal" })
    expect(screen.getByRole("button", { name: "创建项目" })).not.toBeDisabled()
  })

  it("submits auto-derived payload and closes", () => {
    const onClose = vi.fn()
    const onCreate = vi.fn((_data: Payload) => {})
    mount({ onCreate, onClose })

    fill({ name: "Merchant Portal" })
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }))

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith({
      name: "Merchant Portal",
      shortName: "MP",
      description: "",
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("supports manual shortName override and description", () => {
    const onCreate = vi.fn((_data: Payload) => {})
    mount({ onCreate })

    fill({ name: "数据中台", shortName: "dc", description: "指标统一服务" })
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }))

    expect(onCreate).toHaveBeenCalledWith({
      name: "数据中台",
      shortName: "DC",
      description: "指标统一服务",
    })
  })

  it("closes via cancel without calling onCreate", () => {
    const onClose = vi.fn()
    const onCreate = vi.fn((_data: Payload) => {})
    mount({ onCreate, onClose })
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
