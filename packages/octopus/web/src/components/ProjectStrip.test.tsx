import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { currentProject } from "../lib/datasource"
import { ProjectStrip } from "./ProjectStrip"

describe("ProjectStrip", () => {
  it("renders all metrics inline", () => {
    render(<ProjectStrip summary={currentProject()} onOpenKanban={() => {}} onOpenRequirements={() => {}} />)
    expect(screen.getByText("78%")).toBeInTheDocument()
    expect(screen.getByText("28")).toBeInTheDocument()
    expect(screen.getByText("/40")).toBeInTheDocument()
    expect(screen.getByText("24")).toBeInTheDocument()
    expect(screen.getByText("10-31")).toBeInTheDocument()
    // 成员 8 人，显示前 3 个 + 溢出计数
    expect(screen.getByText("+5")).toBeInTheDocument()
  })

  it("overdue metric uses warn tone when >0", () => {
    const p = { ...currentProject(), overdue: 3 }
    render(<ProjectStrip summary={p} onOpenKanban={() => {}} onOpenRequirements={() => {}} />)
    const warn = screen.getAllByText(/3|逾期/).some((el) => el.className.includes("text-warn"))
    expect(warn).toBe(true)
  })

  it("opens kanban and requirements drawers", () => {
    const onKanban = vi.fn()
    const onReqs = vi.fn()
    render(<ProjectStrip summary={currentProject()} onOpenKanban={onKanban} onOpenRequirements={onReqs} />)
    fireEvent.click(screen.getByRole("button", { name: /任务看板/ }))
    fireEvent.click(screen.getByRole("button", { name: /需求池/ }))
    expect(onKanban).toHaveBeenCalledOnce()
    expect(onReqs).toHaveBeenCalledOnce()
  })
})
