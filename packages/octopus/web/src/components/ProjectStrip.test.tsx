import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { currentProject } from "../lib/datasource"
import { ProjectStrip } from "./ProjectStrip"

describe("ProjectStrip", () => {
  it("renders metrics inline without progress or member stack", () => {
    render(<ProjectStrip summary={currentProject()} onOpenKanban={() => {}} onOpenModules={() => {}} />)
    expect(screen.getByText("28")).toBeInTheDocument()
    expect(screen.getByText("/40")).toBeInTheDocument()
    expect(screen.getByText("24")).toBeInTheDocument()
    expect(screen.getByText("10-31")).toBeInTheDocument()
    // 已按需求移除：整体进度与成员头像叠
    expect(screen.queryByText("78%")).not.toBeInTheDocument()
    expect(screen.queryByText("+5")).not.toBeInTheDocument()
  })

  it("overdue metric uses warn tone when >0", () => {
    const p = { ...currentProject(), overdue: 3 }
    render(<ProjectStrip summary={p} onOpenKanban={() => {}} onOpenModules={() => {}} />)
    const warn = screen.getAllByText(/3|逾期/).some((el) => el.className.includes("text-warn"))
    expect(warn).toBe(true)
  })

  it("opens kanban drawer", () => {
    const onKanban = vi.fn()
    render(<ProjectStrip summary={currentProject()} onOpenKanban={onKanban} onOpenModules={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /任务看板/ }))
    expect(onKanban).toHaveBeenCalledOnce()
  })

  it("opens modules drawer", () => {
    const onModules = vi.fn()
    render(<ProjectStrip summary={currentProject()} onOpenKanban={() => {}} onOpenModules={onModules} />)
    fireEvent.click(screen.getByRole("button", { name: /已装模块/ }))
    expect(onModules).toHaveBeenCalledOnce()
  })

  it("需求入口已移除（需求功能由 octopus-requirements 插件承载）", () => {
    render(<ProjectStrip summary={currentProject()} onOpenKanban={() => {}} onOpenModules={() => {}} />)
    expect(screen.queryByRole("button", { name: /需求池/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /新建需求/ })).not.toBeInTheDocument()
  })
})
