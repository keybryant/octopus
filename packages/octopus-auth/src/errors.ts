export class HttpError extends Error {
  readonly statusCode: number
  readonly code: string
  constructor(statusCode: number, code: string, message?: string) {
    super(message ?? code)
    this.name = "HttpError"
    this.statusCode = statusCode
    this.code = code
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError
}

export function httpError(statusCode: number, code: string, message?: string): HttpError {
  return new HttpError(statusCode, code, message)
}
