import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ProjectSettingsModal, type SettingsProject } from "./ProjectSettingsModal"

const project: SettingsProject = {
  id: "prjABCD", name: "Octopus Platform", description: "旧介绍", status: "active",
  workspacePath: "~/octopus-projects/Octopus Platform", createdAt: "2026-08-26T02:00:00.000Z",
}

function renderModal(overrides: Partial<Parameters<typeof ProjectSettingsModal>[0]> = {}) {
  const onSave = vi.fn(async () => true)
  const onDelete = vi.fn(async () => true)
  const onClose = vi.fn()
  render(<ProjectSettingsModal open onClose={onClose} project={project} onSave={onSave} onDelete={onDelete} {...overrides} />)
  return { onSave, onDelete, onClose }
}

describe("ProjectSettingsModal", () => {
  it("renders readonly fields (incl. prj id) and prefilled editable ones", () => {
    renderModal()
    expect(screen.getByText("Octopus Platform")).toBeInTheDocument()
    expect(screen.getByText("prjABCD")).toBeInTheDocument()
    expect(screen.getByText(/octopus-projects\/Octopus Platform/)).toBeInTheDocument()
    expect(screen.getByRole("textbox")).toHaveValue("旧介绍")
    expect(screen.getByText("进行中")).toBeInTheDocument()
  })

  it("saves edited values and closes on success", async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderModal()
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新介绍" } })
    await user.click(screen.getByText("进行中"))
    await user.click(screen.getByText("已归档"))
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ description: "新介绍", status: "archived" }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("keeps open and shows error when save fails", async () => {
    const onSave = vi.fn(async () => false)
    renderModal({ onSave })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(screen.getByText(/保存失败/)).toBeInTheDocument())
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("opens confirm dialog on delete click; cancel does not call onDelete", async () => {
    const user = userEvent.setup()
    const { onDelete } = renderModal()
    fireEvent.click(screen.getByRole("button", { name: "删除项目" }))
    expect(await screen.findByText(/确定要删除项目「Octopus Platform」吗/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByText(/确定要删除项目/)).not.toBeInTheDocument()
  })

  it("confirms delete in dialog; failure shows error in main modal", async () => {
    const onDelete = vi.fn(async () => false)
    renderModal({ onDelete })
    fireEvent.click(screen.getByRole("button", { name: "删除项目" }))
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }))
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
    expect(screen.getByText(/删除失败/)).toBeInTheDocument()
  })

  it("cancel closes without callbacks", () => {
    const { onSave, onDelete, onClose } = renderModal()
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })
})
