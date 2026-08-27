export interface UserRecord {
  id: string
  username: string
  passwordHash: string
  role: 'admin' | 'user'
  disabled: boolean
  createdAt: number
}

export interface SessionRecord {
  id: string
  userId: string
  createdAt: number
  expiresAt: number
}

export type UsersErrorCode = 'invalid' | 'conflict' | 'not-found' | 'closed'

export class UsersError extends Error {
  readonly code: UsersErrorCode
  constructor(code: UsersErrorCode, message: string) {
    super(`[octopus-users] ${message}`)
    this.name = 'UsersError'
    this.code = code
  }
}
