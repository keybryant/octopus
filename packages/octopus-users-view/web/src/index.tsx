import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Input, Modal } from "octopus-ui"
import { ApiError, createUser, deleteUser, listUsers, patchUser, type ManagedUser } from "./api.js"

type DialogKind = "delete" | "reset" | null

export default function UsersView() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [error, setError] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [target, setTarget] = useState<ManagedUser | null>(null)
  const [confirmPwd, setConfirmPwd] = useState("")
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setUsers(await listUsers())
      setError("")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const closeDialog = () => {
    setDialog(null)
    setTarget(null)
    setConfirmPwd("")
  }

  const onCreate = async () => {
    if (!username || password.length < 8) return
    setBusy(true)
    try {
      await createUser({ username, password, role })
      setUsername("")
      setPassword("")
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onPatch = async (id: string, patch: Parameters<typeof patchUser>[1]) => {
    try {
      await patchUser(id, patch)
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  const onToggleDisabled = (u: ManagedUser) => {
    void onPatch(u.id, { disabled: !u.disabled })
  }

  const openDelete = (u: ManagedUser) => {
    setTarget(u)
    setDialog("delete")
  }

  const confirmDelete = async () => {
    if (!target) return
    setBusy(true)
    try {
      await deleteUser(target.id)
      closeDialog()
      await refresh()
    } catch (e) {
      closeDialog()
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const openReset = (u: ManagedUser) => {
    setTarget(u)
    setConfirmPwd("")
    setDialog("reset")
  }

  const confirmReset = async () => {
    if (!target) return
    if (confirmPwd.length < 8) { setError("密码至少 8 位"); return }
    setBusy(true)
    try {
      await onPatch(target.id, { password: confirmPwd })
      closeDialog()
    } catch (e) {
      closeDialog()
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 text-[13px] text-foreground">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); void onCreate() }}
      >
        <Input
          className="w-[150px]"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          className="w-[150px]"
          placeholder="密码（≥8位）"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground focus:border-accent focus:outline-none"
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "user")}
        >
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <Button variant="primary" size="sm" disabled={!username || password.length < 8 || busy} type="submit">
          创建用户
        </Button>
      </form>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-danger">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border bg-surface-hover/50 px-4 py-2.5 text-xs text-text-faint">
          <span className="flex-1">用户</span>
          <span className="w-16">角色</span>
          <span className="w-28" />
        </div>
        {users.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-text-faint">暂无用户</div>
        )}
        {users.map((u) => (
          <div
            key={u.id}
            className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-surface-hover/30"
          >
            <span className="flex-1">
              <span className={u.disabled ? "text-text-faint line-through" : ""}>{u.username}</span>
              {u.disabled && <span className="ml-2 text-xs text-danger">已禁用</span>}
            </span>
            <span className="w-16">
              {u.role === "admin"
                ? <Badge tone="warn">管理员</Badge>
                : <Badge tone="neutral">用户</Badge>}
            </span>
            <span className="flex w-28 items-center justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => openReset(u)}>重置密码</Button>
              <Button size="sm" variant="ghost" onClick={() => onToggleDisabled(u)}>
                {u.disabled ? "启用" : "禁用"}
              </Button>
              <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => openDelete(u)}>
                删除
              </Button>
            </span>
          </div>
        ))}
      </div>

      <Modal
        open={dialog === "delete"}
        onOpenChange={(o) => !o && closeDialog()}
        title="删除用户"
        widthClass="max-w-md"
      >
        <p className="text-[13px] text-foreground">
          确认删除 {target?.username}？该操作会使其会话立即失效，不可恢复。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={closeDialog}>取消</Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void confirmDelete()}>
            确认删除
          </Button>
        </div>
      </Modal>

      <Modal
        open={dialog === "reset"}
        onOpenChange={(o) => !o && closeDialog()}
        title="重置密码"
        widthClass="max-w-md"
      >
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">
            为 {target?.username} 设置新密码
          </label>
          <Input
            type="password"
            placeholder="新密码（≥8位）"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
          />
          {confirmPwd.length > 0 && confirmPwd.length < 8 && (
            <span className="text-xs text-danger">密码至少 8 位</span>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={closeDialog}>取消</Button>
          <Button size="sm" variant="primary" disabled={busy || confirmPwd.length < 8} onClick={() => void confirmReset()}>
            确认重置
          </Button>
        </div>
      </Modal>
    </div>
  )
}
