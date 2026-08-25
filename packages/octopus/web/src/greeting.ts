export function timeGreeting(hour: number): string {
  if (hour >= 5 && hour < 11) return "早上好"
  if (hour >= 11 && hour < 13) return "中午好"
  if (hour >= 13 && hour < 18) return "下午好"
  return "晚上好"
}
