export interface MeResponse {
  user: { id: string; username: string; role: "admin" | "user" }
  canLogout: boolean
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch("/api/octopus-auth/me", { credentials: "same-origin" })
  if (!res.ok) throw new Error("unauthorized")
  return (await res.json()) as MeResponse
}

export function redirectToLogin(_reason?: string): void {
  window.location.href =
    `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
}

export async function logout(): Promise<void> {
  await fetch("/api/octopus-auth/logout", { method: "POST", credentials: "same-origin" })
  redirectToLogin()
}
