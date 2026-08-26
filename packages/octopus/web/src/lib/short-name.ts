/**
 * 由项目名推导头像字符：
 * - 中文名取第一个字
 * - 英文取前两个单词的首字母；单词不足时取前两个字母
 */
export function deriveShortName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ""
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(0, 1)
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}
