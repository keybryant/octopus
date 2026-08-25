import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./index"

function Harness({ onAction }: { onAction?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>打开</DropdownMenuTrigger>
      <DropdownMenuContent data-testid="panel">
        <DropdownMenuLabel>分组</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onAction}>菜单项</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe("DropdownMenu", () => {
  it("opens on trigger click and closes via Escape (radix built-in)", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByText("菜单项")).not.toBeInTheDocument()
    await user.click(screen.getByText("打开"))
    expect(screen.getByText("菜单项")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByText("菜单项")).not.toBeInTheDocument()
  })

  it("item select invokes callback", async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<Harness onAction={onAction} />)
    await user.click(screen.getByText("打开"))
    await user.click(screen.getByText("菜单项"))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it("renders group label", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText("打开"))
    expect(screen.getByText("分组")).toBeInTheDocument()
  })
})
