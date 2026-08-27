import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto"
import { promisify } from "node:util"

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

export const SCRYPT_N = 16384
export const SCRYPT_R = 8
export const SCRYPT_P = 1
export const SCRYPT_KEYLEN = 32
export const SALT_LEN = 16

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3])
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  try {
    const salt = Buffer.from(parts[4], "hex")
    const expected = Buffer.from(parts[5], "hex")
    if (salt.length !== SALT_LEN || expected.length !== SCRYPT_KEYLEN) return false
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, { N, r, p })
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** 用户不存在时也执行一次等价开销的校验，抹平响应时间差（防用户名枚举） */
export const DUMMY_HASH: Promise<string> = hashPassword("octopus-dummy-password-for-timing")
