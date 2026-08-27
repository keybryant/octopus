export interface ManagedUser {
  id: string
  username: string
  role: "admin" | "user"
  disabled: boolean
  createdAt: number
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  })
  if (!res.ok) {
    let code = String(res.status)
    let message = res.statusText
    try {
      const clone = res.clone()
      const data = (await clone.json()) as { error?: string; message?: string }
      code = data.error ?? code
      message = data.message ?? message
    } catch {
      // 保持默认
    }
    throw new ApiError(res.status, code, message)
  }
  return res.status === 204 ? null : res.json()
}

export async function listUsers(): Promise<ManagedUser[]> {
  const data = (await request("/api/octopus-auth/users")) as { users: ManagedUser[] }
  return data.users
}

export async function createUser(
  input: { username: string; password: string; role: "admin" | "user" },
): Promise<void> {
  await request("/api/octopus-auth/users", { method: "POST", body: JSON.stringify(input) })
}

export async function patchUser(
  id: string,
  patch: { role?: "admin" | "user"; disabled?: boolean; password?: string },
): Promise<void> {
  await request(`/api/octopus-auth/users/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify(patch),
  })
}

export async function deleteUser(id: string): Promise<void> {
  await request(`/api/octopus-auth/users/${encodeURIComponent(id)}`, { method: "DELETE" })
}
