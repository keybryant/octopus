import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { ApiError, createUser, deleteUser, listUsers, patchUser, type ManagedUser } from "./api.js"

const s: Record<string, CSSProperties> = {
  wrap: { fontFamily: "system-ui, sans-serif", fontSize: 14, maxWidth: 720 },
  form: { display: "flex", gap: 8, margin: "12px 0", alignItems: "center", flexWrap: "wrap" },
  input: { padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6 },
  select: { padding: "6px", border: "1px solid #d1d5db", borderRadius: 6 },
  btn: { padding: "5px 12px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #e5e7eb" },
  name: { flex: 1 },
  badge: { fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "#e5e7eb" },
  danger: { color: "#b91c1c" },
  err: { color: "#dc2626", marginTop: 8 },
}

export default function UsersView() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [error, setError] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")

  const refresh = useCallback(async () => {
    try {
      setUsers(await listUsers())
      setError("")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const onCreate = async () => {
    try {
      await createUser({ username, password, role })
      setUsername(""); setPassword("")
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
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

  const onDelete = async (u: ManagedUser) => {
    if (!window.confirm(`确定删除 ${u.username}？其所有会话将被注销。`)) return
    try {
      await deleteUser(u.id)
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }

  const onResetPassword = async (u: ManagedUser) => {
    const pwd = window.prompt(`为 ${u.username} 设置新密码（至少 8 位）`)
    if (pwd === null) return
    if (pwd.length < 8) { setError("密码至少 8 位"); return }
    await onPatch(u.id, { password: pwd })
  }

  return (
    <div style={s.wrap}>
      <div style={s.form}>
        <input style={{ ...s.input, width: 140 }} placeholder="用户名" value={username}
          onChange={(e) => setUsername(e.target.value)} />
        <input style={{ ...s.input, width: 140 }} placeholder="密码（≥8位）" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        <select style={s.select} value={role} onChange={(e) => setRole(e.target.value as "admin" | "user")}>
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <button style={s.btn} onClick={() => void onCreate()} disabled={!username || password.length < 8}>
          创建用户
        </button>
      </div>
      {error && <div style={s.err}>{error}</div>}
      {users.map((u) => (
        <div key={u.id} style={s.row}>
          <span style={{ ...s.name, ...(u.disabled ? s.danger : {}) }}>
            {u.username}{u.disabled ? "（已禁用）" : ""}
          </span>
          <span style={s.badge}>{u.role === "admin" ? "管理员" : "用户"}</span>
          <button style={s.btn} onClick={() => void onResetPassword(u)}>重置密码</button>
          <button style={s.btn} onClick={() => void onPatch(u.id, { disabled: !u.disabled })}>
            {u.disabled ? "启用" : "禁用"}
          </button>
          <button style={{ ...s.btn, ...(u.disabled ? {} : s.danger) }} onClick={() => void onDelete(u)}>
            删除
          </button>
        </div>
      ))}
    </div>
  )
}
