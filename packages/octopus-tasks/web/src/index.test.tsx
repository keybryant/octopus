import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import TasksModule from "./index"

describe("TasksModule（骨架）", () => {
  it("渲染模块标题", () => {
    render(<TasksModule />)
    expect(screen.getByText("任务看板")).toBeInTheDocument()
  })
})
