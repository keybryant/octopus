// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import UsersView from "./index"

const users = [
  { id: "u1", username: "admin", role: "admin" as const, disabled: false, createdAt: 1 },
  { id: "u2", username: "bob", role: "user" as const, disabled: false, createdAt: 2 },
]

const listUsers = vi.fn().mockResolvedValue(users)
const createUser = vi.fn().mockResolvedValue(undefined)
const patchUser = vi.fn().mockResolvedValue(undefined)
const deleteUser = vi.fn().mockResolvedValue(undefined)

vi.mock("./api.js", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, public code: string, msg: string) { super(msg) } },
  listUsers: () => listUsers(),
  createUser: (...a: unknown[]) => createUser(...a),
  patchUser: (...a: unknown[]) => patchUser(...a),
  deleteUser: (...a: unknown[]) => deleteUser(...a),
}))

beforeEach(() => {
  listUsers.mockResolvedValue(users)
})

afterEach(() => vi.clearAllMocks())

describe("UsersView 用户管理面板", () => {
  it("渲染用户表格：用户名、角色徽章与操作按钮", async () => {
    render(<UsersView />)
    expect(await screen.findByText("admin")).toBeInTheDocument()
    expect(screen.getByText("bob")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "创建用户" })).toBeInTheDocument()
    const disableBtns = screen.getAllByRole("button", { name: /禁用|启用/ })
    expect(disableBtns).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(2)
  })

  it("创建表单：密码 <8 位时按钮禁用", async () => {
    render(<UsersView />)
    await screen.findByText("admin")
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText("用户名"), "carol")
    await user.type(screen.getByPlaceholderText("密码（≥8位）"), "short")
    const btn = screen.getByRole("button", { name: "创建用户" })
    expect(btn).toBeDisabled()
  })

  it("创建用户成功调用 createUser", async () => {
    render(<UsersView />)
    await screen.findByText("admin")
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText("用户名"), "carol")
    await user.type(screen.getByPlaceholderText("密码（≥8位）"), "carolpass1")
    await user.click(screen.getByRole("button", { name: "创建用户" }))
    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith({ username: "carol", password: "carolpass1", role: "user" }),
    )
  })

  it("删除用户弹出确认 Modal，确认后调用 deleteUser", async () => {
    render(<UsersView />)
    await screen.findByText("admin")
    const user = userEvent.setup()
    await user.click(screen.getAllByRole("button", { name: "删除" })[1])
    expect(await screen.findByRole("dialog")).toHaveTextContent("确认删除 bob")
    await user.click(screen.getByRole("button", { name: "确认删除" }))
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith("u2"))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("重置密码 Modal：密码不足 8 位时确认按钮禁用", async () => {
    render(<UsersView />)
    await screen.findByText("admin")
    const user = userEvent.setup()
    await user.click(screen.getAllByRole("button", { name: "重置密码" })[1])
    expect(await screen.findByRole("dialog")).toHaveTextContent("为 bob 设置新密码")
    await user.type(screen.getByPlaceholderText("新密码（≥8位）"), "short")
    expect(screen.getByRole("button", { name: "确认重置" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})
