import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { WorkbenchModuleInfo } from "../api"
import { ModulesDrawer } from "./ModulesDrawer"

describe("ModulesDrawer", () => {
  it("shows empty hint when no modules registered", () => {
    render(<ModulesDrawer open onClose={() => {}} modules={[]} />)
    expect(screen.getByText("暂无已装模块")).toBeInTheDocument()
  })

  it("renders module cards from registry (lazy-load chain alive)", async () => {
    const modules: WorkbenchModuleInfo[] = [
      { id: "quickstart", title: "快捷入口", entry: "/octopus/quickstart/assets/index.js" },
    ]
    render(<ModulesDrawer open onClose={() => {}} modules={modules} />)
    expect(await screen.findByRole("button", { name: "快捷入口" })).toBeInTheDocument()
  })
})
